import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import type { FeedbackVote } from '@wizzn/shared'

/** Finger travel that commits a vote */
export const SWIPE_COMMIT_PX = 72
/** Travel before the gesture is classified as horizontal or vertical */
const AXIS_LOCK_PX = 10
/** Horizontal must dominate vertical by this factor, so feed scrolling never votes */
const AXIS_RATIO = 1.5

export interface SwipeEdges {
  /** Finger moves right ("weniger davon") is allowed: audio, or a written deck on its cover */
  less: boolean
  /** Finger moves left ("mehr davon") is allowed: audio, or a written deck on its last slide */
  more: boolean
}

/**
 * Edge-overscroll swipe feedback (spec: knowledge stream).
 * Written decks scroll horizontally between slides, so a vote only starts where native scrolling
 * cannot move any further. Touch events are used because pointer events get cancelled as soon as
 * the WebView starts a native scroll.
 */
export function useSwipeFeedback(el: Ref<HTMLElement | null>, edges: () => SwipeEdges, onVote: (vote: FeedbackVote) => void) {
  const dx = ref(0)
  let start: { x: number; y: number; edges: SwipeEdges } | null = null
  let axis: 'x' | 'y' | null = null

  const direction = computed<FeedbackVote | null>(() => (dx.value < 0 ? 1 : dx.value > 0 ? -1 : null))
  /** 0…1 towards the commit threshold, for the overlay */
  const progress = computed(() => Math.min(1, Math.abs(dx.value) / SWIPE_COMMIT_PX))

  function begin(x: number, y: number): void {
    start = { x, y, edges: edges() }
    axis = null
    dx.value = 0
  }

  function move(x: number, y: number): void {
    if (!start) return
    const ddx = x - start.x
    const ddy = y - start.y
    if (!axis) {
      if (Math.abs(ddx) < AXIS_LOCK_PX && Math.abs(ddy) < AXIS_LOCK_PX) return
      axis = Math.abs(ddx) > Math.abs(ddy) * AXIS_RATIO ? 'x' : 'y'
    }
    if (axis !== 'x') return
    const allowed = ddx < 0 ? start.edges.more : start.edges.less
    dx.value = allowed ? ddx : 0
  }

  function end(): void {
    if (start && axis === 'x' && Math.abs(dx.value) >= SWIPE_COMMIT_PX && direction.value) onVote(direction.value)
    start = null
    axis = null
    dx.value = 0
  }

  const onTouchStart = (e: TouchEvent): void => {
    const t = e.touches[0]
    if (t && e.touches.length === 1) begin(t.clientX, t.clientY)
    else end()
  }
  const onTouchMove = (e: TouchEvent): void => {
    const t = e.touches[0]
    if (t) move(t.clientX, t.clientY)
  }
  // Desktop web: mouse drag behaves like a swipe
  const onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 && !(e.target as HTMLElement).closest('button, a, [role="slider"], audio')) begin(e.clientX, e.clientY)
  }
  const onMouseMove = (e: MouseEvent): void => move(e.clientX, e.clientY)

  function attach(node: HTMLElement): void {
    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchmove', onTouchMove, { passive: true })
    node.addEventListener('touchend', end)
    node.addEventListener('touchcancel', end)
    node.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', end)
  }
  function detach(node: HTMLElement): void {
    node.removeEventListener('touchstart', onTouchStart)
    node.removeEventListener('touchmove', onTouchMove)
    node.removeEventListener('touchend', end)
    node.removeEventListener('touchcancel', end)
    node.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', end)
  }

  watch(el, (node, old) => {
    if (old) detach(old)
    if (node) attach(node)
  }, { immediate: true })
  onUnmounted(() => el.value && detach(el.value))

  return { dx, direction, progress }
}
