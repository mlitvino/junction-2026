export type TrustAgentFeedback = "approved" | "purchased" | "loved";

const eventName = "luukku:trust-agent-feedback";

/** Purchase reactions require API confirmation; chat reactions require a submitted message. */
export function announceTrustAgentFeedback(feedback: TrustAgentFeedback) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<TrustAgentFeedback>(eventName, { detail: feedback }));
  }
}

export function subscribeTrustAgentFeedback(listener: (feedback: TrustAgentFeedback) => void) {
  const receive = (event: Event) => {
    const feedback = (event as CustomEvent<TrustAgentFeedback>).detail;
    if (feedback === "approved" || feedback === "purchased" || feedback === "loved")
      listener(feedback);
  };
  window.addEventListener(eventName, receive);
  return () => window.removeEventListener(eventName, receive);
}
