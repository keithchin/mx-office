// What deleting a project needs of the office (office.ts makes it from the real one; the tests make
// their own with temp folders and a fake gh).

import type { DeleteJobView, DeleteRequest } from '../../shared/project-delete.js';
import type { Gh } from './repo.js';

/** The project as floors.json has it. */
export interface DeleteFloor {
  id: string;
  name: string;
  repo?: string;
  dir: string;
  projectId?: string;
  /** The project the office was started in (it keeps its own data there). */
  local: boolean;
}

export interface DeleteDeps {
  dataDir: string;
  /** The office's projects folder: only folders inside it are ever deleted. */
  projectsHome(): string;
  /** The project, from floors.json (open or closed). */
  floor(id: string): DeleteFloor | undefined;
  /** How many agents it has now (0 once its floor is closed). */
  agents(id: string): number;
  /** Why nothing may happen to it now (a pause or a safe restart under way), else undefined. */
  blocked(id: string): string | undefined;
  /** Stops and sends home every agent (worktrees kept for the next step) and closes its floor; resolves how many. */
  stopAgents(id: string, by: string): Promise<number>;
  /** Takes it out of floors.json; why not, else undefined. */
  removeFloor(id: string, by: string): string | undefined;
  /** Its entry in the toolkit pin book (for the archive); `remove` takes it out. */
  pin(id: string, remove?: boolean): unknown;
  /** Retires its prj_ id. */
  retire(f: DeleteFloor, by: string): void;
  /** The audit log's project.delete record. */
  audit(f: DeleteFloor, by: { name: string; id?: string }, job: DeleteJobView): void;
  /** Every open page leaves it. */
  announce(f: DeleteFloor, by: string): void;
  gh: Gh;
  /** The office is in test mode. */
  testMode(): boolean;
  /** gh is the tests' fake (test mode never reaches the real GitHub delete). */
  ghIsFake(): boolean;
  now(): number;
}

/** A job as <data>/deleted/jobs/<floor>.json keeps it, so a failed one carries on where it stopped. */
export interface JobRecord extends DeleteJobView {
  def: DeleteFloor;
  request: Omit<DeleteRequest, 'confirm'>;
  byId?: string;
}
