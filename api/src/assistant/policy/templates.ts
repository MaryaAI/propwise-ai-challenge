export interface TemplateOutput {
  summary: string;
  reply: string;
  followUpTask: { title: string; notes: string | null } | null;
}

/**
 * The fallback title for a route that must propose a follow-up (architecture section 2) when the
 * model supplied no `followUpTask` of its own. Whether an action exists is a code decision; the
 * model only ever contributes the wording.
 */
export function followUpTitle(leadName: string): string {
  return `Follow up with ${leadName}`;
}

export function rentTemplate(leadName: string): TemplateOutput {
  return {
    summary: `${leadName} is looking to rent, but our listings are for sale only.`,
    reply: "Thanks for reaching out! Just to let you know, our current listings are for sale only. I'll follow up with you about your options.",
    followUpTask: { title: `Follow up with ${leadName} about rental options`, notes: null },
  };
}

export function clarifyTemplate(leadName: string): TemplateOutput {
  return {
    summary: `${leadName} hasn't shared what they're looking for yet.`,
    reply: "Thanks for reaching out! Could you tell me more about what you're looking for -- area, bedrooms, and budget?",
    followUpTask: { title: `Ask ${leadName} about their requirements`, notes: null },
  };
}

/**
 * The `change_follow_up` route (architecture section 2): the agent asked to move the appointment,
 * so a new task with the new date is proposed and no model call is needed.
 */
export function changeFollowUpTemplate(leadName: string): TemplateOutput {
  return {
    // Not "has been rescheduled": nothing is written until the agent approves, and approving
    // creates a new task rather than moving the old one. `summary` is a contract field ("what Sara
    // should know"), so it must not claim a change that has not happened.
    summary: `A follow-up with ${leadName} at the new time is waiting for your approval. The existing one is unchanged until you approve it.`,
    reply: `I have drafted a follow-up with ${leadName} for the new time. Approve it to add it to your tasks.`,
    followUpTask: { title: `Follow up with ${leadName}`, notes: null },
  };
}

export function closedTemplate(leadName: string): TemplateOutput {
  return {
    summary: `${leadName} is no longer interested.`,
    reply: 'Thanks for letting us know -- we will leave it here.',
    followUpTask: null,
  };
}
