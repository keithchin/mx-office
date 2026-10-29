// Where Edit in Studio Pro opens a project when it isn't the project's own folder (server/studio/targets.ts): for a
// project on Mendix Team Server, a Studio copy whose origin is Team Server, so Studio Pro treats it as a Team Server
// app (Publish, deploy to a licensed node) and signs in with the person's own Mendix account.

export interface StudioTarget {
  kind: 'teamserver';
  /** The copy's folder on the office's machine. */
  dir: string;
  /** It's there already (made by an earlier Edit in Studio Pro). */
  ready: boolean;
  /** Its origin (Team Server's plain URL: never a token). */
  origin: string;
  /** What the confirm says before Studio Pro opens it (pull first, Publish commits for you…). */
  hints: readonly string[];
}
