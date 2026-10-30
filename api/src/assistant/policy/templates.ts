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

export function closedTemplate(leadName: string): TemplateOutput {
  return {
    summary: `${leadName} is no longer interested.`,
    reply: 'Thanks for letting us know -- we will leave it here.',
    followUpTask: null,
  };
}
