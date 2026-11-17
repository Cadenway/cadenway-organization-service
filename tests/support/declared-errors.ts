import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

// The error codes each operation of `openapi/internal/organization-service.yaml` declares, read
// from the spec of the installed `@cadenway/contracts`: the gateway answers 503 for a code the
// internal contract does not declare, so every refusal of a route must be one of them.

/** A node of the parsed spec. */
type Node = Readonly<Record<string, unknown>>;

/** An error response seen by a test. */
export interface SeenError {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly code: string;
}

/** Codes written in backticks in a description, such as `organization.not-found`. */
const CODE_IN_TEXT = /`([a-z][a-z-]*\.[a-z][a-z-]*)`/gu;

/**
 * Reads a member of a node as a node.
 *
 * @param node - The node.
 * @param key - The member.
 * @returns The member, or an empty node.
 */
function child(node: unknown, key: string): Node {
  const value: unknown =
    typeof node === 'object' && node !== null ? (node as Node)[key] : undefined;
  return typeof value === 'object' && value !== null ? (value as Node) : {};
}

/** The declared error codes of the operations of the internal spec. */
export class DeclaredErrors {
  /** The parsed spec. */
  private readonly spec: Node;

  private constructor(spec: Node) {
    this.spec = spec;
  }

  /**
   * Loads the spec the installed contracts package ships.
   *
   * @returns The declared errors.
   */
  public static load(): DeclaredErrors {
    const file: string = fileURLToPath(
      import.meta.resolve('@cadenway/contracts/specs/openapi/internal/organization-service.yaml'),
    );
    return new DeclaredErrors(parse(readFileSync(file, 'utf8')) as Node);
  }

  /**
   * Follows a local `$ref` of the spec.
   *
   * @param node - A node that may be a reference.
   * @returns The node it references, or itself.
   */
  private resolve(node: Node): Node {
    const ref: unknown = node.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/')) {
      return node;
    }
    return ref
      .slice(2)
      .split('/')
      .reduce((current: Node, key: string) => child(current, key), this.spec);
  }

  /**
   * The codes a response declares, in its description and its examples.
   *
   * @param response - The response object, or a reference to one.
   * @returns The codes.
   */
  private codesOf(response: Node): Set<string> {
    const resolved: Node = this.resolve(response);
    const codes: Set<string> = new Set<string>();
    const description: unknown = resolved.description;
    if (typeof description === 'string') {
      for (const match of description.matchAll(CODE_IN_TEXT)) {
        codes.add(match[1] ?? '');
      }
    }
    for (const media of Object.values(child(resolved, 'content'))) {
      const example: unknown = child(media, 'example').code;
      if (typeof example === 'string') {
        codes.add(example);
      }
      for (const named of Object.values(child(media, 'examples'))) {
        const value: unknown = child(this.resolve(named as Node), 'value').code;
        if (typeof value === 'string') {
          codes.add(value);
        }
      }
    }
    return codes;
  }

  /**
   * Whether an operation declares an error.
   *
   * @param error - The error a route answered.
   * @returns Whether the status and the code are declared for the operation of the route.
   */
  public declares(error: SeenError): boolean {
    for (const [template, item] of Object.entries(child(this.spec, 'paths'))) {
      const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/gu, '[^/]+')}$`, 'u');
      if (!pattern.test(error.path)) {
        continue;
      }
      const responses: Node = child(child(item, error.method), 'responses');
      const response: Node = child(responses, String(error.status));
      return this.codesOf(response).has(error.code);
    }
    return false;
  }
}
