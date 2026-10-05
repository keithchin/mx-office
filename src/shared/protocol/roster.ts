// The project team (see shared/roster/): the Team tab fetches what it shows over HTTP
// (GET /api/roster) and acts through POST /api/roster/action, so the socket only says when to fetch again.

export type RosterServerMsg =
  /** Something on the floor's team changed (a member, a standup, a proposal, the settings): fetch it again. */
  { t: 'roster.changed'; floor: string; alert?: RosterAlert };

/** An urgent or critical escalation just raised: the flat views turn it into a desktop notification. */
export interface RosterAlert {
  id: string;
  urgency: 'urgent' | 'critical';
  title: string;
  body: string;
}
