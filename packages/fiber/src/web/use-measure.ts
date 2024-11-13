import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import createDebounce from 'debounce'

declare type ResizeObserverCallback = (entries: any[], observer: ResizeObserver) => void
declare class ResizeObserver {
  constructor(callback: ResizeObserverCallback)
  observe(target: Element, options?: any): void
  unobserve(target: Element): void
  disconnect(): void
  static toString(): string
}

export interface RectReadOnly {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
  [key: string]: number
}

type HTMLOrSVGElement = HTMLElement | SVGElement

type Result = [(element: HTMLOrSVGElement | null) => void, RectReadOnly, () => void]

type State = {
  element: HTMLOrSVGElement | null
  scrollContainers: HTMLOrSVGElement[] | null
  resizeObserver: ResizeObserver | null
  lastBounds: RectReadOnly
  orientationHandler: null | (() => void)
}

export interface Options {
  debounce?: number | { scroll: number; resize: number }
  scroll?: boolean
  polyfill?: { new (cb: ResizeObserverCallback): ResizeObserver }
  offsetSize?: boolean
}

export interface EnhancedOptions extends Options {
  throttle?: number
  onResize?: (bounds: RectReadOnly) => void
  onScroll?: (bounds: RectReadOnly) => void
  observeChildren?: boolean
}

export function useEnhancedMeasure({
  debounce,
  scroll = false,
  polyfill,
  offsetSize = false,
  throttle,
  onResize,
  onScroll,
  observeChildren = false,
}: EnhancedOptions = {}): Result {
  const ResizeObserver = polyfill || (typeof window !== 'undefined' && (window as any).ResizeObserver)

  const [bounds, set] = useState<RectReadOnly>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    bottom: 0,
    right: 0,
    x: 0,
    y: 0,
  })

  // In test mode
  if (!ResizeObserver) {
    // @ts-ignore
    bounds.width = 1280
    // @ts-ignore
    bounds.height = 800
    return [() => {}, bounds, () => {}]
  }

  const state = useRef<State>({
    element: null,
    scrollContainers: null,
    resizeObserver: null,
    lastBounds: bounds,
    orientationHandler: null,
  })

  const scrollDebounce = debounce ? (typeof debounce === 'number' ? debounce : debounce.scroll) : null
  const resizeDebounce = debounce ? (typeof debounce === 'number' ? debounce : debounce.resize) : null

  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => void (mounted.current = false)
  }, [])

  const updateBounds = useCallback(() => {
    if (!state.current.element) return
    const newBounds = state.current.element.getBoundingClientRect() as unknown as RectReadOnly

    const size = {
      ...newBounds,
      height: offsetSize && state.current.element instanceof HTMLElement ? state.current.element.offsetHeight : newBounds.height,
      width: offsetSize && state.current.element instanceof HTMLElement ? state.current.element.offsetWidth : newBounds.width,
    }

    Object.freeze(size)
    if (mounted.current && !areBoundsEqual(state.current.lastBounds, size)) {
      set((state.current.lastBounds = size))
      onResize && onResize(size)
    }
  }, [set, offsetSize, onResize])

  const scrollHandler = useCallback(() => {
    updateBounds()
    onScroll && onScroll(state.current.lastBounds)
  }, [updateBounds, onScroll])

  const [forceRefresh, resizeChange, scrollChange] = useMemo(() => {
    const throttledUpdate = throttle ? throttleFunction(updateBounds, throttle) : updateBounds
    const throttledScroll = throttle ? throttleFunction(scrollHandler, throttle) : scrollHandler
    return [
      updateBounds,
      debounce ? createDebounce(throttledUpdate, typeof debounce === 'number' ? debounce : debounce.resize || 0) : throttledUpdate,
      debounce ? createDebounce(throttledScroll, typeof debounce === 'number' ? debounce : debounce.scroll || 0) : throttledScroll,
    ]
  }, [updateBounds, scrollHandler, debounce, throttle])

  const removeListeners = useCallback(() => {
    if (state.current.scrollContainers) {
      state.current.scrollContainers.forEach((element) => element.removeEventListener('scroll', scrollChange, true))
      state.current.scrollContainers = null
    }

    if (state.current.resizeObserver) {
      state.current.resizeObserver.disconnect()
      state.current.resizeObserver = null
    }

    if (state.current.orientationHandler) {
      if ('orientation' in screen && 'removeEventListener' in screen.orientation) {
        screen.orientation.removeEventListener('change', state.current.orientationHandler)
      } else if ('onorientationchange' in window) {
        window.removeEventListener('orientationchange', state.current.orientationHandler)
      }
    }
  }, [scrollChange])

  const addListeners = useCallback(() => {
    if (!state.current.element) return
    state.current.resizeObserver = new ResizeObserver(resizeChange)
    state.current.resizeObserver?.observe(state.current.element)
    if (scroll && state.current.scrollContainers) {
      state.current.scrollContainers.forEach((scrollContainer) =>
        scrollContainer.addEventListener('scroll', scrollChange, { capture: true, passive: true }),
      )
    }

    state.current.orientationHandler = () => {
      scrollChange()
    }

    if ('orientation' in screen && 'addEventListener' in screen.orientation) {
      screen.orientation.addEventListener('change', state.current.orientationHandler)
    } else if ('onorientationchange' in window) {
      window.addEventListener('orientationchange', state.current.orientationHandler)
    }
  }, [scroll, scrollChange, resizeChange])

  const ref = useCallback((node: HTMLOrSVGElement | null) => {
    if (!node || node === state.current.element) return
    removeListeners()
    state.current.element = node
    state.current.scrollContainers = findScrollContainers(node)
    addListeners()
    
    if (observeChildren) {
      const childObserver = new MutationObserver(() => {
        resizeChange()
      })
      childObserver.observe(node, { childList: true, subtree: true })
      return () => childObserver.disconnect()
    }
  }, [removeListeners, addListeners, resizeChange, observeChildren])

  useEffect(() => {
    const onWindowScroll = () => {
      if (scroll) {
        scrollChange()
      }
    }
    window.addEventListener('scroll', onWindowScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', onWindowScroll, true)
  }, [scroll, scrollChange])

  useEffect(() => {
    window.addEventListener('resize', resizeChange)
    return () => window.removeEventListener('resize', resizeChange)
  }, [resizeChange])

  useEffect(() => {
    removeListeners()
    addListeners()
  }, [scroll, scrollChange, resizeChange, removeListeners, addListeners])

  useEffect(() => removeListeners, [removeListeners])

  return [ref, bounds, forceRefresh]
}

function throttleFunction<T extends (...args: any[]) => void>(func: T, limit: number): T {
  let inThrottle: boolean
  return function(this: any, ...args: Parameters<T>): void {
    if (!inThrottle) {
      func.apply(this, args)
      inThrottle = true
      setTimeout(() => inThrottle = false, limit)
    }
  } as T
}

function findScrollContainers(element: HTMLOrSVGElement | null): HTMLOrSVGElement[] {
  const result: HTMLOrSVGElement[] = []
  if (!element || element === document.body) return result
  const { overflow, overflowX, overflowY } = window.getComputedStyle(element)
  if ([overflow, overflowX, overflowY].some((prop) => prop === 'auto' || prop === 'scroll')) result.push(element)
  return [...result, ...findScrollContainers(element.parentElement)]
}

const keys: (keyof RectReadOnly)[] = ['x', 'y', 'top', 'bottom', 'left', 'right', 'width', 'height']
const areBoundsEqual = (a: RectReadOnly, b: RectReadOnly): boolean => keys.every((key) => a[key] === b[key])