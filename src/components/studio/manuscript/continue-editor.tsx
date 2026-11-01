"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createStudioPlanItem } from "@/actions/studio/create-studio-plan-item";
import { StudioRequestError } from "@/components/studio/studio-fetch";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";

import type { ContinueTarget } from "./manuscript-layout";
import { useWritingLoop } from "./use-writing-loop";

const CREATE_FAILED = "A new moment could not be created for your writing.";

/**
 * The continue editor is a MomentEditor in "continue" mode, rendered at the
 * target's place in the flat block list. Its key is the key the moment will
 * have once written, so the same Lexical instance carries on as that
 * moment's editor and the caret never jumps mid-sentence.
 */
export function useContinueEditor(target: ContinueTarget | null) {
  const { state, dispatch } = useStudioStore();
  const storyId = state.story.id;
  // Moments created by the continue editor, mapped to the key they were born with.
  const [bindings, setBindings] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  const keyFor = useCallback(
    (momentId: string) => bindings.get(momentId) ?? `moment:${momentId}`,
    [bindings],
  );
  const continueKey =
    target?.kind === "moment"
      ? keyFor(target.moment.id)
      : `continue:${bindings.size}`;

  /** First keystroke into a scene or "new" target creates its moment. */
  const createMoment = useCallback(async (): Promise<string | null> => {
    const current = targetRef.current;
    if (!current) return null;
    if (current.kind === "moment") return current.moment.id;
    const result = await createStudioPlanItem({
      storyId,
      kind: "moment",
      parentId: current.kind === "scene" ? current.scene.id : current.sceneId,
      afterItemId: current.kind === "new" ? current.afterMomentId : null,
    });
    if (!result?.data) {
      throw new StudioRequestError(
        result?.serverError?.message ??
          result?.validationErrors?.formErrors?.[0] ??
          CREATE_FAILED,
      );
    }
    const { item, shifted } = result.data;
    // The continue block's key is `continue:<size>` until this binding lands.
    setBindings((current) =>
      new Map(current).set(item.id, `continue:${current.size}`),
    );
    dispatch({ type: "merge", planItems: [item, ...shifted] });
    return item.id;
  }, [dispatch, storyId]);

  return { continueKey, createMoment, keyFor };
}

export function continueTargetTitle(target: ContinueTarget): string {
  if (target.kind === "moment") return target.moment.title.trim();
  if (target.kind === "scene") return target.scene.title.trim();
  return "";
}

export function continuePlaceholder(target: ContinueTarget): string {
  return target.kind === "new" ? "Keep writing…" : "…or start typing";
}

/** The quiet "Continue with [target] ▸" line above the empty continue area. */
export function ContinueLine({ target }: { target: ContinueTarget }) {
  const loop = useWritingLoop();
  // Nothing is planned after the last moment, so there is no brief to write
  // from; the author types, or plans more in the tree.
  if (target.kind === "new") return null;

  const title =
    continueTargetTitle(target) ||
    (target.kind === "moment" ? "the next moment" : "the next scene");
  const isPreparing =
    target.kind === "scene" && loop.preparingSceneId === target.scene.id;

  return (
    <div className="my-6 flex items-center justify-center gap-2 font-sans text-caption text-muted-foreground">
      {isPreparing ? (
        <>
          <span aria-live="polite">
            Planning the moments of <em className="text-foreground">{title}</em>
            …
          </span>
          <button
            className="rounded-sm px-1.5 py-0.5 underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={loop.stop}
            type="button"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          className="rounded-sm px-2 py-1 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          disabled={loop.isKeeping}
          onClick={() => {
            if (target.kind === "moment") void loop.write(target.moment.id);
            else void loop.startScene(target.scene.id);
          }}
          type="button"
        >
          Continue with <em className="text-foreground">{title}</em>{" "}
          <span aria-hidden="true" className="text-accent">
            ▸
          </span>
        </button>
      )}
    </div>
  );
}
