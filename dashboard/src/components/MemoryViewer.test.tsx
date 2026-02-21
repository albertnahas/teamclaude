// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryViewer } from "./MemoryViewer";

const mockMemory = (overrides: object = {}) => ({
  id: "mem-1",
  role: "sprint-engineer",
  key: "architecture",
  value: "Use ESM imports",
  sprintId: "sprint-abc",
  createdAt: new Date("2026-02-21T14:00:00Z").getTime(),
  accessCount: 2,
  lastAccessed: null,
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MemoryViewer", () => {
  it("shows loading state initially then renders memories", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve([mockMemory()]),
    } as Response);

    const onClose = vi.fn();
    render(<MemoryViewer onClose={onClose} />);

    expect(screen.getByText("Loading...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("sprint-engineer")).toBeDefined();
      expect(screen.getByText("architecture")).toBeDefined();
      expect(screen.getByText("Use ESM imports")).toBeDefined();
    });
  });

  it("shows empty state when no memories returned", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve([]),
    } as Response);

    render(<MemoryViewer onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No memories yet.")).toBeDefined();
    });
  });

  it("shows filter message when search yields no results", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: () => Promise.resolve([]) } as Response)
      .mockResolvedValueOnce({ json: () => Promise.resolve([]) } as Response);

    const { getByPlaceholderText } = render(<MemoryViewer onClose={vi.fn()} />);

    await waitFor(() => screen.getByText("No memories yet."));

    const input = getByPlaceholderText("Search memories...");
    fireEvent.change(input, { target: { value: "nonexistent" } });

    await waitFor(() => {
      expect(screen.getByText("No memories match your filter.")).toBeDefined();
    });
  });

  it("calls onClose when Close button is clicked", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve([]),
    } as Response);

    const onClose = vi.fn();
    const { getByText } = render(<MemoryViewer onClose={onClose} />);

    await waitFor(() => getByText("Close"));
    fireEvent.click(getByText("Close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when overlay background is clicked", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve([]),
    } as Response);

    const onClose = vi.fn();
    const { container } = render(<MemoryViewer onClose={onClose} />);

    await waitFor(() => screen.getByText("No memories yet."));

    const overlay = container.querySelector(".checkpoint-overlay")!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("removes memory from list after delete", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: () => Promise.resolve([mockMemory()]) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    const { getByTitle } = render(<MemoryViewer onClose={vi.fn()} />);

    await waitFor(() => screen.getByText("Use ESM imports"));

    fireEvent.click(getByTitle("Delete memory"));

    await waitFor(() => {
      expect(screen.queryByText("Use ESM imports")).toBeNull();
    });
  });

  it("fetches with search query param when search changes", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: () => Promise.resolve([]) } as Response)
      .mockResolvedValueOnce({ json: () => Promise.resolve([]) } as Response);

    const { getByPlaceholderText } = render(<MemoryViewer onClose={vi.fn()} />);

    await waitFor(() => screen.getByText("No memories yet."));

    fireEvent.change(getByPlaceholderText("Search memories..."), { target: { value: "arch" } });

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls;
      expect(calls.some((c) => String(c[0]).includes("q=arch"))).toBe(true);
    });
  });

  it("shows role filter select when multiple roles present", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve([
          mockMemory({ id: "1", role: "sprint-engineer" }),
          mockMemory({ id: "2", role: "sprint-manager" }),
        ]),
    } as Response);

    render(<MemoryViewer onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("All roles")).toBeDefined();
    });
  });

  it("shows dash in Sprint column when sprintId is null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve([mockMemory({ sprintId: null })]),
    } as Response);

    render(<MemoryViewer onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("—")).toBeDefined();
    });
  });
});
