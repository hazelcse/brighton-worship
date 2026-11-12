"use client";

import { useEffect, useRef, useState } from "react";

/** How far (px) the mouse must move before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 5;
/** Momentum after letting go: speed kept per 16ms frame, and the speed (px/ms) where it stops. */
const FRICTION = 0.94;
const MIN_SPEED = 0.02;

/**
 * A single row that scrolls sideways. Touch and trackpads use the browser's own scrolling (with its
 * momentum and snapping); with a mouse you can also press and drag it, and it carries on gliding a
 * little after you let go, then settles on the nearest card. It stops at either end (no looping).
 * A drag never counts as a click on the card under the pointer.
 */
export function DragScroll({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const [dragging, setDragging] = useState(false);

  // Show the fades only where there's more to scroll to.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdges({ start: el.scrollLeft > 1, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startLeft = 0;
    let pressed = false;
    let moved = false;
    let frame = 0;
    // Recent positions, for the speed when letting go.
    let samples: { x: number; t: number }[] = [];

    /** Glide to the card nearest the current position (the cards are the row's children). */
    const settle = () => {
      const cards = [...el.children] as HTMLElement[];
      const max = el.scrollWidth - el.clientWidth;
      const nearest = cards.reduce(
        (best, c) => (Math.abs(c.offsetLeft - el.scrollLeft) < Math.abs(best - el.scrollLeft) ? c.offsetLeft : best),
        0,
      );
      el.style.scrollSnapType = "";
      el.scrollTo({ left: Math.min(nearest, max), behavior: "smooth" });
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return; // touch: the browser scrolls natively
      cancelAnimationFrame(frame);
      pressed = true;
      moved = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      samples = [{ x: e.clientX, t: e.timeStamp }];
    };
    const onMove = (e: PointerEvent) => {
      if (!pressed) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        setDragging(true);
        el.setPointerCapture(e.pointerId);
        el.style.scrollSnapType = "none"; // snapping would fight the drag
      }
      el.scrollLeft = startLeft - dx; // the browser clamps this to the ends
      samples.push({ x: e.clientX, t: e.timeStamp });
      if (samples.length > 5) samples.shift();
    };
    const onUp = () => {
      if (!pressed) return;
      pressed = false;
      if (!moved) return;
      setDragging(false);
      const first = samples[0]!;
      const last = samples[samples.length - 1]!;
      let v = last.t > first.t ? -(last.x - first.x) / (last.t - first.t) : 0; // px/ms, in scroll direction
      let prev = performance.now();
      const glide = (now: number) => {
        const dt = now - prev;
        prev = now;
        const before = el.scrollLeft;
        el.scrollLeft += v * dt;
        v *= Math.pow(FRICTION, dt / 16);
        // Stop when slow, or when it has hit an end.
        if (Math.abs(v) < MIN_SPEED || el.scrollLeft === before) settle();
        else frame = requestAnimationFrame(glide);
      };
      frame = requestAnimationFrame(glide);
    };
    // After a drag, swallow the click so the card under the pointer doesn't open.
    const onClick = (e: MouseEvent) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };
    // Stop the browser dragging the link or text itself.
    const onDragStart = (e: DragEvent) => e.preventDefault();
    // A wheel or trackpad scroll takes over from any glide.
    const onWheel = () => cancelAnimationFrame(frame);

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("click", onClick, true);
    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("dragstart", onDragStart);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={ref}
        className={`scroll-quiet flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain ${dragging ? "cursor-grabbing select-none" : edges.start || edges.end ? "cursor-grab" : ""} ${className}`}
      >
        {children}
      </div>
      {/* Fades on whichever side has more cards. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity ${edges.start ? "opacity-100" : "opacity-0"}`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent transition-opacity ${edges.end ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
