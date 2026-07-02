import { getStore } from "@netlify/blobs";

// API endpoint that serves all stored messages to the frontend

export default async (req, context) => {
    try {
        const store = getStore("lamix-messages");

        let messages = [];
        try {
            const raw = await store.get("messages", { type: "json" });
            if (Array.isArray(raw)) messages = raw;
        } catch (e) {
            // No data stored yet
        }

        return new Response(
            JSON.stringify({
                status: "success",
                total: messages.length,
                source: "stored",
                data: messages,
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                },
            }
        );
    } catch (err) {
        console.error("Messages error:", err);
        return new Response(
            JSON.stringify({ status: "error", message: err.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
};
