import { getStore } from "@netlify/blobs";

// API endpoint that serves and clears stored messages for the frontend

function getResetKey() {
    return "reset-state";
}

function shouldReset(now = new Date()) {
    const resetHour = 5;
    const resetMinute = 30;
    const resetTime = new Date(now);
    resetTime.setHours(resetHour, resetMinute, 0, 0);

    if (now < resetTime) return false;

    return true;
}

async function clearStoredMessages(store) {
    try {
        await store.delete("messages");
    } catch (err) {
        try {
            await store.setJSON("messages", []);
        } catch (fallbackErr) {
            console.warn("Could not delete messages blob, falling back to empty payload:", fallbackErr);
        }
    }

    try {
        await store.delete("reset-state");
    } catch (err) {
        // Ignore cleanup failures; the next set call will overwrite.
    }

    await store.set("reset-state", new Date().toISOString());
}

export default async (req, context) => {
    try {
        const store = getStore("lamix-messages");

        if (req.method === "POST" || req.method === "DELETE") {
            await clearStoredMessages(store);
            return new Response(
                JSON.stringify({ status: "success", cleared: true, source: "stored" }),
                {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": "no-cache",
                    },
                }
            );
        }

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
