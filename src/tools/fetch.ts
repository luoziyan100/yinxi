/**
 * Fetch tool - retrieve content from URLs.
 * Useful for reading documentation, checking APIs, and fetching remote resources.
 */

import type { Tool, ToolResult } from "../types.js";

const MAX_RESPONSE_SIZE = 100_000; // 100KB
const FETCH_TIMEOUT = 30_000; // 30 seconds

export function createFetchTool(): Tool {
  return {
    name: "Fetch",
    description:
      "Fetch content from a URL. Returns the response body as text.\n\n" +
      "Usage:\n" +
      "- Use to read documentation, check API endpoints, or fetch remote content.\n" +
      "- Supports HTTP and HTTPS only.\n" +
      "- Response is truncated at 100KB.\n" +
      "- Do NOT use to generate or guess URLs. Only fetch URLs provided by the user or found in project files.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch.",
        },
        method: {
          type: "string",
          description: "HTTP method (GET, POST, etc.). Default: GET.",
        },
        headers: {
          type: "string",
          description: "JSON string of headers to include.",
        },
      },
      required: ["url"],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const url = params.url as string;
      const method = (params.method as string) || "GET";
      const headersStr = params.headers as string | undefined;

      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return { content: `Error: Invalid URL "${url}"`, isError: true };
      }

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return { content: `Error: Only HTTP and HTTPS URLs are supported.`, isError: true };
      }

      // Parse headers
      let headers: Record<string, string> = {};
      if (headersStr) {
        try {
          headers = JSON.parse(headersStr);
        } catch {
          return { content: "Error: Invalid headers JSON.", isError: true };
        }
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        const response = await fetch(url, {
          method,
          headers: {
            "User-Agent": "Yinxi-Agent/0.1",
            ...headers,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return {
            content: `HTTP ${response.status} ${response.statusText}`,
            isError: true,
          };
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("image") || contentType.includes("audio") || contentType.includes("video")) {
          return {
            content: `Binary content (${contentType}), ${response.headers.get("content-length") || "unknown"} bytes`,
          };
        }

        let body = await response.text();
        if (body.length > MAX_RESPONSE_SIZE) {
          body = body.substring(0, MAX_RESPONSE_SIZE) + "\n\n... [response truncated at 100KB]";
        }

        return { content: body };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("abort")) {
          return { content: `Error: Request timed out after ${FETCH_TIMEOUT / 1000}s`, isError: true };
        }
        return { content: `Error fetching URL: ${message}`, isError: true };
      }
    },
  };
}
