import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFetchOnce } from "@/lib/use-fetch-once";

describe("useFetchOnce", () => {
  it("starts in loading state, then succeeds with the fetcher's resolved value", async () => {
    const resolvedValue = { total: 42 };
    const fetcher = () => Promise.resolve(resolvedValue);

    const { result } = renderHook(() => useFetchOnce(fetcher));

    expect(result.current.status).toBe("loading");

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });

    expect(result.current.status).toBe("success");
    if (result.current.status === "success") {
      expect(result.current.data).toEqual(resolvedValue);
    }
  });
});
