// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  createEditor,
  HISTORY_PUSH_TAG,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import {
  AiDraftNode,
  type ChapterRewriteTransactionRef,
  createChapterAiDraftHandle,
  readChapterContentForSave,
  registerChapterDraftHistoryGuard,
} from "./chapter-ai-draft-plugin";
import { CHAPTER_MARKDOWN_TRANSFORMERS } from "./chapter-markdown";

function setup(markdown: string, start: number, end: number, lastBlock = 0) {
  const editor = createEditor({
    nodes: [AiDraftNode],
    onError(error) {
      throw error;
    },
  });
  const history = createEmptyHistoryState();
  registerHistory(editor, history, 300);
  registerChapterDraftHistoryGuard(editor);
  editor.update(
    () => {
      $convertFromMarkdownString(
        markdown,
        CHAPTER_MARKDOWN_TRANSFORMERS,
        undefined,
        true,
      );
      const paragraphs = $getRoot().getChildren();
      const firstParagraph = paragraphs[0];
      const lastParagraph = paragraphs[lastBlock];
      if (!$isElementNode(firstParagraph) || !$isElementNode(lastParagraph))
        throw new Error("Missing paragraph");
      const first = firstParagraph.getAllTextNodes()[0];
      const last = lastParagraph.getAllTextNodes().at(-1);
      if (!first || !last) throw new Error("Missing text");
      const selection = $createRangeSelection();
      selection.anchor.set(first.getKey(), start, "text");
      selection.focus.set(last.getKey(), end, "text");
      $setSelection(selection);
    },
    { discrete: true },
  );
  const transaction: ChapterRewriteTransactionRef = { current: null };
  const handle = createChapterAiDraftHandle(editor, transaction, history);
  const read = () =>
    editor
      .getEditorState()
      .read(() =>
        $convertToMarkdownString(
          CHAPTER_MARKDOWN_TRANSFORMERS,
          undefined,
          true,
        ),
      );
  const save = () =>
    readChapterContentForSave(editor.getEditorState(), transaction);
  const flush = () => editor.update(() => {}, { discrete: true });
  return { editor, history, transaction, handle, read, save, flush };
}

function requireSnapshot(
  handle: ReturnType<typeof createChapterAiDraftHandle>,
) {
  const snapshot = handle.createDraftSnapshot();
  if (!snapshot) throw new Error("Missing draft snapshot");
  return snapshot;
}

describe("chapter rewrite transactions", () => {
  test("reject restores exact spaces, formatting, paragraphs and backward selection", () => {
    const fixture = setup(
      "Before **selected** after\n\nNext *paragraph*.",
      2,
      1,
      2,
    );
    fixture.editor.update(
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error("missing range");
        const anchor = { ...selection.anchor };
        selection.anchor.set(
          selection.focus.key,
          selection.focus.offset,
          selection.focus.type,
        );
        selection.focus.set(anchor.key, anchor.offset, anchor.type);
      },
      { discrete: true },
    );
    const original = fixture.editor.getEditorState().toJSON();
    const selection = fixture.editor
      .getEditorState()
      .read(() => $getSelection()?.clone() ?? null);
    const snapshot = requireSnapshot(fixture.handle);
    fixture.handle.updateDraft(snapshot.draftId, "Other prose", "complete");
    fixture.flush();
    fixture.handle.removeDraft(snapshot.draftId);
    expect(fixture.editor.getEditorState().toJSON()).toEqual(original);
    expect(
      fixture.editor
        .getEditorState()
        .read(() => $getSelection()?.is(selection)),
    ).toBe(true);
    expect(fixture.editor.isEditable()).toBe(true);
  });

  test("stop, errors, review, regeneration and save flush retain the original", () => {
    const fixture = setup("Before selected after", 6, 16);
    const original = fixture.read();
    const snapshot = requireSnapshot(fixture.handle);
    expect(snapshot.selectedText).toBe("selected");
    for (const status of [
      "streaming",
      "stopped",
      "error",
      "incomplete",
      "complete",
    ] as const) {
      fixture.handle.updateDraft(snapshot.draftId, "Replacement", status);
      fixture.handle.setContentEditable(true);
      fixture.flush();
      expect(fixture.editor.isEditable()).toBe(false);
      expect(fixture.save()).toBe(original);
    }
    fixture.handle.beginDraftVersion(snapshot.draftId);
    fixture.flush();
    expect(fixture.handle.readInsertionContext(snapshot.draftId)).toMatchObject(
      {
        beforeText: "Before",
        afterText: "after",
        selectedText: "selected",
        isRewrite: true,
      },
    );
    expect(fixture.save()).toBe(original);
    fixture.handle.removeDraft(snapshot.draftId);
    expect(fixture.read()).toBe(original);
  });

  test("unrelated preview updates and unmount serialization cannot save missing prose", () => {
    const fixture = setup("Before selected after", 7, 15);
    const original = fixture.read();
    const snapshot = requireSnapshot(fixture.handle);
    fixture.editor.update(
      () => {
        $getRoot()
          .getAllTextNodes()[0]
          .setTextContent("Unexpected preview edit");
      },
      { discrete: true },
    );
    expect(fixture.save()).toBe(original);
    fixture.handle.setContentEditable(true);
    expect(
      readChapterContentForSave(
        fixture.editor.getEditorState(),
        fixture.transaction,
      ),
    ).toBe(original);
    fixture.handle.removeDraft(snapshot.draftId);
    expect(fixture.read()).toBe(original);
  });

  for (const resolution of ["reject", "accept"] as const) {
    test(`${resolution} restores clean history after an untagged preview edit`, () => {
      const fixture = setup("Before selected after", 7, 15);
      const initial = fixture.read();
      fixture.editor.update(
        () => {
          $getRoot()
            .getAllTextNodes()[0]
            .setTextContent("Before selected after!");
        },
        { discrete: true, tag: HISTORY_PUSH_TAG },
      );
      const original = fixture.read();
      const snapshot = requireSnapshot(fixture.handle);
      fixture.editor.update(
        () => {
          $getRoot()
            .getAllTextNodes()[0]
            .setTextContent("Unexpected preview edit");
        },
        { discrete: true, tag: HISTORY_PUSH_TAG },
      );
      if (resolution === "accept") {
        fixture.handle.acceptDraft(snapshot.draftId, "new");
      } else {
        fixture.handle.removeDraft(snapshot.draftId);
      }
      const resolved = fixture.read();
      expect(resolved).toBe(
        resolution === "accept" ? "Before new after!" : original,
      );
      const step = (command: typeof UNDO_COMMAND | typeof REDO_COMMAND) => {
        fixture.editor.dispatchCommand(command, undefined);
        fixture.flush();
        expect(
          JSON.stringify(fixture.editor.getEditorState().toJSON()),
        ).not.toContain('"ai-draft"');
      };
      if (resolution === "accept") {
        step(UNDO_COMMAND);
        expect(fixture.read()).toBe(original);
      }
      step(UNDO_COMMAND);
      expect(fixture.read()).toBe(initial);
      step(REDO_COMMAND);
      expect(fixture.read()).toBe(original);
      if (resolution === "accept") step(REDO_COMMAND);
      expect(fixture.read()).toBe(resolved);
    });
  }

  test("accept preserves spaces and forms one undoable manuscript edit", () => {
    const fixture = setup("Before selected after", 6, 16);
    const original = fixture.read();
    const snapshot = requireSnapshot(fixture.handle);
    fixture.handle.updateDraft(snapshot.draftId, "new", "complete");
    fixture.flush();
    expect(fixture.handle.acceptDraft(snapshot.draftId, "new")).toBe(true);
    expect(fixture.read()).toBe("Before new after");
    expect(fixture.save()).toBe("Before new after");
    expect(fixture.transaction.current).toBeNull();
    fixture.editor.dispatchCommand(UNDO_COMMAND, undefined);
    fixture.flush();
    expect(fixture.read()).toBe(original);
    fixture.editor.dispatchCommand(REDO_COMMAND, undefined);
    fixture.flush();
    expect(fixture.read()).toBe("Before new after");
    expect(
      JSON.stringify(fixture.editor.getEditorState().toJSON()),
    ).not.toContain('"ai-draft"');
  });

  test("accept joins partial cross-paragraph selection edges", () => {
    const fixture = setup("Before selected\n\nselected after", 7, 8, 2);
    const snapshot = requireSnapshot(fixture.handle);
    expect(
      fixture.handle.acceptDraft(snapshot.draftId, "first\n\nsecond"),
    ).toBe(true);
    expect(fixture.read()).toBe("Before first\nsecond after");
  });

  test("whitespace-only selection remains a rewrite at chapter end", () => {
    const fixture = setup("Text  ", 4, 6);
    const snapshot = requireSnapshot(fixture.handle);
    expect(snapshot.isRewrite).toBe(true);
    expect(snapshot.atChapterEnd).toBe(false);
    expect(fixture.transaction.current).not.toBeNull();
    fixture.handle.removeDraft(snapshot.draftId);
    expect(fixture.read()).toBe("Text  ");
  });

  test("ordinary inline insertion regeneration includes same-paragraph neighbours", () => {
    const fixture = setup("Before after", 7, 7);
    const snapshot = requireSnapshot(fixture.handle);
    expect(fixture.handle.readInsertionContext(snapshot.draftId)).toMatchObject(
      { beforeText: "Before ", afterText: "after" },
    );
  });

  test("undo and redo cannot resolve or resurrect a pending rewrite", () => {
    const fixture = setup("Before selected after", 7, 15);
    const snapshot = requireSnapshot(fixture.handle);
    fixture.handle.updateDraft(snapshot.draftId, "alternative", "stopped");
    fixture.flush();
    const preview = fixture.editor.getEditorState().toJSON();
    fixture.editor.dispatchCommand(UNDO_COMMAND, undefined);
    fixture.flush();
    expect(fixture.editor.getEditorState().toJSON()).toEqual(preview);
    fixture.editor.dispatchCommand(REDO_COMMAND, undefined);
    fixture.flush();
    expect(fixture.editor.getEditorState().toJSON()).toEqual(preview);
    fixture.handle.removeDraft(snapshot.draftId);
    expect(fixture.read()).toBe("Before selected after");
    expect(
      fixture.history.undoStack.every(
        (entry) =>
          !JSON.stringify(entry.editorState.toJSON()).includes('"ai-draft"'),
      ),
    ).toBe(true);
  });

  test("surrounding edits never resurrect insertion previews through undo", () => {
    const fixture = setup("Before after", 7, 7);
    const snapshot = requireSnapshot(fixture.handle);
    fixture.editor.update(
      () => {
        const first = $getRoot().getAllTextNodes()[0];
        first.setTextContent("Changed before ");
      },
      { discrete: true },
    );
    fixture.handle.acceptDraft(snapshot.draftId, "new");
    fixture.editor.dispatchCommand(UNDO_COMMAND, undefined);
    fixture.flush();
    expect(
      JSON.stringify(fixture.editor.getEditorState().toJSON()),
    ).not.toContain('"ai-draft"');
    expect(fixture.read()).toContain("Changed before");
  });

  test("empty or stale acceptance cannot discard a pending rewrite", () => {
    const fixture = setup("Before selected after", 7, 15);
    const snapshot = requireSnapshot(fixture.handle);
    expect(fixture.handle.acceptDraft(snapshot.draftId, " ")).toBe(false);
    expect(fixture.handle.acceptDraft("stale-id", "new")).toBe(false);
    expect(fixture.transaction.current?.draftId).toBe(snapshot.draftId);
    expect(fixture.save()).toBe("Before selected after");
  });
});
