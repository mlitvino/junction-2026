"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/components/lib/utils";
import {
  subscribeTrustAgentFeedback,
  type TrustAgentFeedback,
} from "@/client/trust-agent-feedback";

export type TrustAgentEyesState = "idle" | "scanning" | "hold" | "approved" | "blocked";

export interface TrustAgentEyesProps {
  state?: TrustAgentEyesState;
  size?: number;
  className?: string;
}

const colors: Record<TrustAgentEyesState, [string, string]> = {
  idle: ["#F8FAFC", "#F8FAFC"],
  scanning: ["#38BDF8", "#38BDF8"],
  hold: ["#FBBF24", "#F59E0B"],
  approved: ["#34D399", "#10B981"],
  blocked: ["#FB7185", "#F43F5E"],
};

/** Decorative brand mark. Wrap in a labelled link/button when interactive. */
export function TrustAgentEyes({ state = "idle", size = 40, className }: TrustAgentEyesProps) {
  const badge = useRef<HTMLSpanElement>(null);
  const leftEye = useRef<SVGRectElement>(null);
  const rightEye = useRef<SVGRectElement>(null);
  const leftBracket = useRef<SVGPathElement>(null);
  const rightBracket = useRef<SVGPathElement>(null);
  const brackets = useRef<SVGGElement>(null);
  const checks = useRef<SVGGElement>(null);
  const coins = useRef<SVGGElement>(null);
  const motion = useRef({
    frame: 0,
    pointerX: 0,
    pointerY: 0,
    hasPointer: false,
    pointerId: -1,
    isPointerDown: false,
    pointerDownAt: 0,
    blinkUntil: 0,
    blinkAt: 0,
    doubleBlinkAt: 0,
    nextBlinkAt: 0,
    releaseAt: -Infinity,
    enteredAt: 0,
    curX: 0,
    curY: 0,
    scaleY: 1,
    scaleX: 1,
    tilt: 0,
    spread: 0,
    trembleStrength: 0,
    feedback: null as TrustAgentFeedback | null,
    feedbackQueue: [] as TrustAgentFeedback[],
    feedbackAt: 0,
    feedbackTimer: null as ReturnType<typeof setTimeout> | null,
  });

  useEffect(() => {
    const m = motion.current;
    const elements = [leftEye.current, rightEye.current, leftBracket.current, rightBracket.current];
    const [left, right, bracketLeft, bracketRight] = elements;
    const bracketGroup = brackets.current;
    if (!left || !right || !bracketLeft || !bracketRight) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    m.enteredAt = performance.now();
    m.nextBlinkAt = m.enteredAt + 2800 + Math.random() * 3400;
    m.doubleBlinkAt = 0;
    m.blinkAt = 0;

    function nextFeedback() {
      m.feedback = m.feedbackQueue.shift() ?? null;
      m.feedbackAt = performance.now();
      left!.style.opacity = right!.style.opacity = m.feedback ? "0" : "1";
      if (checks.current) checks.current.style.opacity = m.feedback === "approved" ? "1" : "0";
      if (coins.current) coins.current.style.opacity = m.feedback === "purchased" ? "1" : "0";
      if (brackets.current) {
        brackets.current.style.stroke =
          m.feedback === "approved"
            ? "#10B981"
            : m.feedback === "purchased"
              ? "#F59E0B"
              : colors[state][1];
      }
      // Use a timer as well as RAF so the mark resets with reduced motion enabled.
      m.feedbackTimer = m.feedback ? setTimeout(nextFeedback, 1300) : null;
    }
    const unsubscribeFeedback = subscribeTrustAgentFeedback((feedback) => {
      m.feedbackQueue.push(feedback);
      if (!m.feedback) nextFeedback();
    });

    function paint(now: number, reduced = false) {
      const holding = !reduced && m.isPointerDown && now - m.pointerDownAt > 135;
      let goalX = 0;
      let goalY = 0;
      if (!reduced && m.hasPointer && badge.current) {
        const rect = badge.current.getBoundingClientRect();
        const dx = m.pointerX - (rect.left + rect.width / 2);
        const dy = m.pointerY - (rect.top + rect.height / 2);
        const angle = Math.atan2(dy, dx);
        const factor = 1 - Math.exp(-Math.hypot(dx, dy) / 140);
        goalX = Math.cos(angle) * factor;
        goalY = Math.sin(angle) * factor;
      }
      if (!reduced && state === "scanning") goalX = Math.sin(now * 0.0045) * 0.85;
      m.curX = reduced ? 0 : m.curX + (goalX - m.curX) * 0.16;
      m.curY = reduced ? 0 : m.curY + (goalY - m.curY) * 0.16;

      const pop = reduced ? 0 : Math.max(0, 1 - (now - m.releaseAt) / 180);
      const targetY = holding ? 0.22 : state === "blocked" ? 0.28 : 1;
      const targetX = holding ? 1.28 : 1;
      const targetSpread = holding ? -1.8 : state === "blocked" ? -2.2 : 0;
      m.scaleY = reduced ? targetY : m.scaleY + (targetY - m.scaleY) * 0.22;
      m.scaleX = reduced ? targetX : m.scaleX + (targetX - m.scaleX) * 0.22;
      m.tilt = reduced ? 0 : m.tilt + ((holding ? 7.5 : 0) - m.tilt) * 0.22;
      m.spread = reduced ? targetSpread : m.spread + (targetSpread - m.spread) * 0.16;
      m.trembleStrength = reduced
        ? 0
        : m.trembleStrength + ((holding ? 1 : 0) - m.trembleStrength) * 0.14;

      let blinkScale = 1;
      if (!reduced) {
        if (!m.isPointerDown && state !== "blocked") {
          if (now >= m.nextBlinkAt || (m.doubleBlinkAt > 0 && now >= m.doubleBlinkAt)) {
            const second = m.doubleBlinkAt > 0 && now >= m.doubleBlinkAt;
            m.blinkAt = now;
            m.doubleBlinkAt = !second && Math.random() < 0.2 ? now + 190 : 0;
            m.nextBlinkAt = now + 2800 + Math.random() * 3400;
          }
          const elapsed = now - m.blinkAt;
          if (m.blinkAt > 0 && elapsed < 110) {
            blinkScale = 1 - 0.92 * Math.sin((elapsed / 110) * Math.PI);
          }
        }
        if (now < m.blinkUntil) blinkScale = 0.08;
      }
      const jitterX =
        m.trembleStrength * (Math.sin(now * 0.058) * 0.95 + Math.cos(now * 0.093) * 0.45);
      const jitterY =
        m.trembleStrength * (Math.cos(now * 0.071) * 0.75 + Math.sin(now * 0.11) * 0.35);
      const shakeProgress = (now - m.enteredAt) / 340;
      const shake =
        !reduced && state === "blocked" && shakeProgress < 1
          ? Math.sin((now - m.enteredAt) * 0.08) * 2.4 * (1 - shakeProgress)
          : 0;
      const eyeX = m.curX * 5.5 + jitterX + shake;
      const eyeY = m.curY * 4.5 + jitterY;
      const bracketX = m.curX * 1.6 + jitterX * 0.35 + shake;
      const bracketY = m.curY * 1.2 + jitterY * 0.35;
      const spread =
        m.spread + pop * 2 + (!reduced && state === "scanning" ? Math.sin(now * 0.003) * 1.2 : 0);
      const sy =
        (pop > 0 && !holding && state !== "blocked" ? 1 + pop * 0.15 : m.scaleY) * blinkScale;
      const sx = pop > 0 && !holding ? 1 - pop * 0.06 : m.scaleX;
      const curious = state === "hold" && !holding;
      left!.style.transform = `translate(${eyeX}px, ${eyeY}px) rotate(${m.tilt}deg) scale(${sx}, ${sy * (curious ? 0.74 : 1)})`;
      right!.style.transform = `translate(${eyeX}px, ${eyeY}px) rotate(${-m.tilt}deg) scale(${sx}, ${sy * (curious ? 1.06 : 1)})`;
      bracketLeft!.style.transform = `translate(${bracketX - spread}px, ${bracketY}px)`;
      bracketRight!.style.transform = `translate(${bracketX + spread}px, ${bracketY}px)`;
      const feedbackElapsed = now - m.feedbackAt;
      const feedbackPop =
        reduced || !m.feedback
          ? 1
          : 1 + Math.sin(Math.min(1, feedbackElapsed / 280) * Math.PI) * 0.12;
      // Keep both marks at the eyes' position even while hidden, ready for the next reaction.
      for (const mark of [checks.current, coins.current]) {
        if (mark) mark.style.transform = `translate(${eyeX}px, ${eyeY}px) scale(${feedbackPop})`;
      }
    }

    function frame(now: number) {
      paint(now);
      m.frame = requestAnimationFrame(frame);
    }
    function syncMotion() {
      cancelAnimationFrame(m.frame);
      if (media.matches || document.hidden) {
        m.isPointerDown = false;
        paint(performance.now(), true);
      } else {
        m.frame = requestAnimationFrame(frame);
      }
    }
    function move(event: PointerEvent) {
      m.pointerX = event.clientX;
      m.pointerY = event.clientY;
      m.hasPointer = true;
    }
    function leave(event?: PointerEvent) {
      if (event && event.relatedTarget !== null) return;
      m.hasPointer = false;
    }
    function down(event: PointerEvent) {
      if (event.button !== 0 || !event.isPrimary || media.matches) return;
      m.pointerId = event.pointerId;
      m.pointerDownAt = performance.now();
      m.isPointerDown = true;
      m.blinkUntil = m.pointerDownAt + 105;
      // Paint in the event itself so even a busy frame cannot delay the click blink.
      paint(m.pointerDownAt);
    }
    function release(event?: PointerEvent) {
      if (event && event.pointerId !== m.pointerId) return;
      if (m.isPointerDown && performance.now() - m.pointerDownAt > 150) {
        m.releaseAt = performance.now();
      }
      m.isPointerDown = false;
    }
    function blur() {
      release();
      leave();
    }

    window.addEventListener("pointermove", move, { passive: true, capture: true });
    window.addEventListener("pointerleave", leave, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", blur);
    media.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    syncMotion();
    return () => {
      unsubscribeFeedback();
      if (m.feedbackTimer) clearTimeout(m.feedbackTimer);
      m.feedbackQueue = [];
      nextFeedback();
      if (bracketGroup) bracketGroup.style.stroke = "";
      cancelAnimationFrame(m.frame);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerleave", leave, true);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", blur);
      media.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
    };
  }, [state]);

  const [eyeColor, bracketColor] = colors[state];
  return (
    <span
      ref={badge}
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl border border-[#2E343E] bg-[#1B1E23]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg width="80%" viewBox="0 0 64 44" overflow="visible" fill={eyeColor}>
        <g
          ref={brackets}
          fill="none"
          stroke={bracketColor}
          strokeWidth={3.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            ref={leftBracket}
            d="M 15 7 H 10.5 A 5.5 5.5 0 0 0 5 12.5 V 31.5 A 5.5 5.5 0 0 0 10.5 37 H 15"
          />
          <path
            ref={rightBracket}
            d="M 49 7 H 53.5 A 5.5 5.5 0 0 1 59 12.5 V 31.5 A 5.5 5.5 0 0 1 53.5 37 H 49"
          />
        </g>
        <rect
          ref={leftEye}
          x="21"
          y="14"
          width="7.5"
          height="16"
          rx="3.75"
          style={{ transformOrigin: "24.75px 22px" }}
        />
        <rect
          ref={rightEye}
          x="35.5"
          y="14"
          width="7.5"
          height="16"
          rx="3.75"
          style={{ transformOrigin: "39.25px 22px" }}
        />
        <g
          ref={checks}
          fill="none"
          stroke="#34D399"
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: 0, transformOrigin: "32px 22px" }}
        >
          <g transform="translate(32 22) scale(0.75) translate(-32 -22)">
            <path d="m 18.5 22 4.5 4.5 7-9" />
            <path d="m 34 22 4.5 4.5 7-9" />
          </g>
        </g>
        <g ref={coins} style={{ opacity: 0, transformOrigin: "32px 22px" }}>
          <g transform="translate(32 22) scale(0.75) translate(-32 -22)">
            {[24, 40].map((x) => (
              <g key={x}>
                <ellipse
                  cx={x}
                  cy="22"
                  rx="6"
                  ry="9"
                  fill="#FBBF24"
                  stroke="#F59E0B"
                  strokeWidth="1.5"
                />
                <ellipse
                  cx={x}
                  cy="22"
                  rx="3.5"
                  ry="6.3"
                  fill="none"
                  stroke="#FDE68A"
                  strokeWidth="1"
                />
                <path
                  d={`M ${x} 18.5 v 7 M ${x - 1.3} 19.5 h 2.6 M ${x - 1.3} 24.5 h 2.6`}
                  fill="none"
                  stroke="#B45309"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </g>
            ))}
          </g>
        </g>
      </svg>
    </span>
  );
}
