import json

with open("/Users/flans/.gemini/antigravity/brain/4904a9af-74a1-47f0-888c-b2e35972bad4/.system_generated/logs/transcript_full.jsonl", "r") as f:
    for line in f:
        data = json.loads(line)
        if "tool_calls" in data:
            for call in data["tool_calls"]:
                if call["name"] == "write_to_file":
                    target = call["args"].get("TargetFile", "")
                    if "dashboard" in target and "route.ts" in target:
                        print("Found!")
                        with open("reconstructed_dashboard_route.ts", "w") as out:
                            out.write(call["args"].get("CodeContent", ""))
