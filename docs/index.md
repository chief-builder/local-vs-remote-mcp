---
layout: home
hero:
  name: Local vs Remote MCP
  text: Does it matter where an AI's tools run?
  tagline: The same AI, the same jobs, wired three ways. Measured over 400+ published trials.
  actions:
    - theme: brand
      text: How it works
      link: /how-it-works
    - theme: alt
      text: See the results
      link: /results
    - theme: alt
      text: GitHub
      link: https://github.com/chief-builder/local-vs-remote-mcp
features:
  - title: Same cost
    details: The AI read the same amount of text either way. Local and remote token costs were within 1–2% of each other.
  - title: Same speed, in practice
    details: The remote setup adds 0.1–0.2 s per tool use. That is lost in the AI's own thinking time, so neither setup was reliably faster.
  - title: Equally hard to trick
    details: Hidden "ignore your instructions" traps worked 0 times on either setup.
---

## In plain terms

AI assistants such as Claude can use outside tools: read a GitHub repository, open an issue, click around a website. They do it through a standard plug called **MCP** (Model Context Protocol). That plug can be wired up two ways:

- **Local:** the tool program runs on your own computer.
- **Remote:** the tool program runs on someone else's server, and your computer talks to it over the internet.

People argue about which is cheaper, faster or safer, mostly from gut feeling. This project measured it. The same AI did the same jobs both ways: inspect a repository, file an issue, edit a file, browse a web page. It also ran a third time with **no tools at all**, as a "can't do it without help" baseline. That baseline completed 0 tasks, which confirms the tasks really required the tools.

## What we found

- **Cost is the same.** The AI reads the same tool descriptions and results either way, so the bill doesn't depend on the wiring.
- **Speed is basically the same.** The remote round-trip costs about a tenth to a fifth of a second per tool use, which is small next to the time the AI spends thinking.
- **Neither setup is easier to trick.** Traps hidden in the content the AI read worked 0 times on both.

## The catches we found along the way

- **Two alarming early results were scoring mistakes.** The AI looked like it fell for a trap 20–40% of the time. In fact it had refused and *quoted* the trap while explaining why. Another "failure" was the scorer checking GitHub before GitHub had finished setting up the test repository.
- **How the AI finds its tools can fake a security difference.** In the browser experiment one setup looked far riskier (77% vs 33%). That turned out to depend on how the AI searched for tools, not on local versus remote. Controlled for, both were 0%. See [Lessons](./lessons.md).
- **Safety boundaries must be explicit.** The remote server offered a "delete repository" tool the local one didn't. Separately, an AI with no tools tried to get help by messaging other AI sessions on the same computer. Both are now blocked by allowing only named tools, rather than trying to list every forbidden one.

## So which should you choose?

Local versus remote is about **who you trust**, not cost or speed.

- A **local** tool runs with your full access to your computer, so it is only as safe as the software you installed.
- A **remote** tool can't touch your computer, but your data goes to a third party, and your login tokens become the thing to protect.

More in [Threat models](./foundations/threat-models.md).

## How sure is this?

These are small samples: 5 tries per task in the GitHub experiment, 10–30 in the browser experiment. Treat the results as strong hints, not final proof. Every number on this site links to its published report and per-trial data, so you can check it. Start with [Results](./results.md).
