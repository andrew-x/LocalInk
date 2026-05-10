"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type PanPosition = {
  x: number;
  y: number;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const BUTTON_ZOOM_STEP = 0.5;
const WHEEL_ZOOM_STEP = 0.25;

export function useGeneratedImageLightboxViewport() {
  const stageRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    pan: PanPosition;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState<PanPosition>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const canZoomIn = zoom < MAX_ZOOM;
  const canZoomOut = zoom > MIN_ZOOM;

  useEffect(() => {
    if (zoom === MIN_ZOOM) {
      setPan({ x: 0, y: 0 });
      return;
    }

    setPan((currentPan) => clampPan(currentPan, zoom, stageRef.current));
  }, [zoom]);

  function updateZoom(nextZoom: number) {
    setZoom(clampZoom(nextZoom));
  }

  function zoomIn() {
    updateZoom(zoom + BUTTON_ZOOM_STEP);
  }

  function zoomOut() {
    updateZoom(zoom - BUTTON_ZOOM_STEP);
  }

  const resetZoom = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  function toggleZoom() {
    if (zoom === MIN_ZOOM) {
      setZoom(2.5);
      return;
    }

    resetZoom();
  }

  function handleWheel(event: ReactWheelEvent<HTMLElement>) {
    if (isLightboxControlTarget(event.target)) {
      return;
    }

    event.preventDefault();
    updateZoom(zoom + (event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (isLightboxControlTarget(event.target)) {
      return;
    }

    event.preventDefault();

    if (zoom === MIN_ZOOM) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pan,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();

    setPan(
      clampPan(
        {
          x: drag.pan.x + event.clientX - drag.startX,
          y: drag.pan.y + event.clientY - drag.startY,
        },
        zoom,
        stageRef.current,
      ),
    );
  }

  function stopDragging(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      dragRef.current = null;
      setIsDragging(false);
    }
  }

  function handleDoubleClick(event: ReactPointerEvent<HTMLElement>) {
    if (isLightboxControlTarget(event.target)) {
      return;
    }

    toggleZoom();
  }

  return {
    canZoomIn,
    canZoomOut,
    handleDoubleClick,
    handlePointerDown,
    handlePointerMove,
    handleWheel,
    isDragging,
    pan,
    resetZoom,
    stageRef,
    stopDragging,
    zoom,
    zoomIn,
    zoomOut,
  };
}

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function clampPan(
  pan: PanPosition,
  zoom: number,
  stage: HTMLElement | null,
): PanPosition {
  if (!stage || zoom === MIN_ZOOM) {
    return { x: 0, y: 0 };
  }

  const maxX = (stage.clientWidth * (zoom - 1)) / 2;
  const maxY = (stage.clientHeight * (zoom - 1)) / 2;

  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)),
    y: Math.min(maxY, Math.max(-maxY, pan.y)),
  };
}

export function isLightboxControlTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("[data-lightbox-control]"))
  );
}
