/** A current organization member's directory name, without address or role. */
export interface MemberName {
  // #region Properties
  /** The account of the active member. */
  readonly userId: string;

  /** The member's full name from the user directory. */
  readonly name: string;
  // #endregion
}
