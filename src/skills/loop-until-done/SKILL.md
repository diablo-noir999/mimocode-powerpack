---
name: loop-until-done
description: Autonomous loop that repeats a task until completion. Use when you need to iteratively work on something until it's fully done.
---

# Loop Until Done

Use the `ralph_loop` tool to run an autonomous loop that repeats the same prompt until a completion signal appears.

## When to Use

- Getting tests to pass through iteration
- Building a feature incrementally
- Fixing issues that require multiple attempts
- Any task where "keep trying until it works" is appropriate

## How It Works

1. The tool sends your prompt to the agent
2. The agent works on the task, modifying files
3. The tool checks output for the completion signal
4. If not found, the prompt is repeated with the updated codebase
5. The agent sees previous changes and can self-correct
6. Loop continues until completion or max iterations

## Example

```
Use the ralph_loop tool with:
- prompt: "Build a REST API with tests. Run tests after each change. Output <promise>DONE</promise> when all tests pass."
- max_iterations: 20
```

## Tips

- Always set a max iterations limit for safety
- Include clear success criteria in your prompt
- The completion signal must appear exactly as specified
- Use context parameter for hints if the agent gets stuck
