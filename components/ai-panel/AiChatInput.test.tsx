// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiChatInput } from "./AiChatInput";

describe("AiChatInput", () => {
  it("does not submit an Enter keydown while an IME composition is active", () => {
    const onSubmit = vi.fn(async () => true);

    render(
      <AiChatInput
        isSendDisabled={false}
        isStreaming={false}
        onStop={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "Half composed" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
