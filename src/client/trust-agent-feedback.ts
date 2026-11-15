export type TrustAgentFeedback = "approved" | "purchased";

const eventName = "luukku:trust-agent-feedback";

/** Only call after the purchasing API has confirmed success. */
export function announceTrustAgentFeedback(feedback: TrustAgentFeedback) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<TrustAgentFeedback>(eventName, { detail: feedback }));
  }
}

export function subscribeTrustAgentFeedback(listener: (feedback: TrustAgentFeedback) => void) {
  const receive = (event: Event) => {
    const feedback = (event as CustomEvent<TrustAgentFeedback>).detail;
    if (feedback === "approved" || feedback === "purchased") listener(feedback);
  };
  window.addEventListener(eventName, receive);
  return () => window.removeEventListener(eventName, receive);
}
