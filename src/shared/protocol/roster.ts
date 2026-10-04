// The project team (see shared/roster/): the Team tab fetches what it shows over HTTP
// (GET /api/roster) and acts through POST /api/roster/action, so the socket only says when to fetch again.

export type RosterServerMsg =
  /** Something on the floor's team changed (a member, a standup, a proposal, the settings): fetch it again. */
  { t: 'roster.changed'; floor: string };
