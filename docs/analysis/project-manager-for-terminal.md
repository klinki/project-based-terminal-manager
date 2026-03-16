# Project Manager for Terminal feasibility analysis

## Executive summary

If the goal is a **terminal-only** version of Project Window Manager, the idea becomes **much more viable** than the current foreign-window hoisting approach.

But the best path is **not** a Windows Terminal plugin/extension.

The practical ranking is:

1. **Fork Windows Terminal** if you want the feature to feel native inside Terminal.
2. **Build a small external companion/orchestrator** if you want a quick spike before forking.
3. **Do not bet on a plugin/extension path** for this feature.

The reason is simple:

- Windows Terminal already owns the terminal content, tabs, panes, and switching logic.
- Windows Terminal does **not** appear to expose a general runtime plugin model for injecting new UI or behavior into `TerminalPage` / `TerminalWindow`.
- The existing "extension" surface is mainly **settings/profile fragment extensibility**, which is useful for adding profiles and settings data, but not for implementing a Project Window Manager-style UI or behavior layer.

For the simplified scope you suggested:

- no drag/drop
- no tear-out
- no foreign windows
- just switching between terminal-owned content

I think a **Windows Terminal fork is clearly viable**, and much more viable than the original Project Window Manager concept.

## Why this is easier than the current app

The original Project Window Manager challenge is hard because it tries to host **arbitrary external application windows** with `SetParent`.

A terminal-only version changes the problem completely:

- the content is app-owned
- the host UI is app-owned
- focus/input rules are app-owned
- tab/session lifetime is app-owned
- there is already an internal logical model for tabs and panes

That means a "Project Manager for Terminal" is not really window hoisting anymore.

It is closer to:

> grouping, selecting, and switching between Windows Terminal-owned session containers.

That is a much healthier architecture.

## What Windows Terminal already gives you

From the local Terminal checkout:

- `TerminalPage` already owns a logical `_tabs` collection
- `TabManagement.cpp` already centralizes tab selection through `_SelectTab(uint32_t tabIndex)`
- `AppCommandlineArgs.cpp` already supports:
  - `-w,--window` to target a specific window
  - `focus-tab` / `ft` to switch tabs
- the process model already supports multi-window routing inside one app architecture
- if you ever need it later, the app already has `ContentManager`, `ContentId`, `AttachContent`, and `SendContentToOther` for internal content transfer

That means your reduced feature set does **not** need to invent a foreign hosting mechanism at all.

It can sit on top of existing Terminal concepts.

## Option 1: plugin / extension

### Short answer

**Not a good path for this feature.**

### Why

The extension-like mechanism I found in Windows Terminal is centered around **fragments** and **app extensions for settings**.

Important evidence:

- `SettingsLoader::FindFragmentsAndMergeIntoUserSettings(...)` in `src\cascadia\TerminalSettingsModel\CascadiaSettingsSerialization.cpp`
- `AppExtensionHostName{ L"com.microsoft.windows.terminal.settings" }`
- `FragmentSettings` in `src\cascadia\TerminalSettingsModel\CascadiaSettings.h`

What those fragments represent in code today:

- new profiles
- modified profiles
- color schemes

And from the proto-extension spec:

- packaged apps can provide fragment JSON via a `windows.appExtension`
- unpackaged apps can drop JSON into `...\Windows Terminal\Fragments\{app-name}`

That is valuable as a **settings integration** mechanism.

It is **not** a general runtime plugin host for:

- adding new Terminal window chrome
- injecting a custom side panel
- taking over the tab strip
- adding a new internal project/session manager model
- intercepting tab selection with custom state management
- attaching custom WinUI views into `TerminalPage`

I did **not** find a general "load arbitrary plugin DLL and let it extend the Terminal UI/runtime" architecture.

So if by "plugin/extension" you mean:

> "Can I bolt Project Window Manager-like behavior onto stock Windows Terminal without forking it?"

my answer is:

**Probably no, not in any clean or durable way.**

### What fragments could still help with

Fragments are still useful for lightweight terminal-oriented integration, for example:

- shipping project-specific profiles
- shipping color schemes
- shipping actions/tasks metadata
- shipping starter layouts or shell entry points

But that is supporting material. It is not the foundation for the feature itself.

## Option 2: external companion / orchestrator

### Short answer

**Viable for a quick spike, but not the best final UX.**

This is not exactly what you asked for, but it is worth calling out because it could be a very practical first step.

### Why it is viable

Windows Terminal already exposes some useful control surfaces:

- `-w,--window` in `AppCommandlineArgs.cpp`
- `focus-tab` / `ft`
- existing startup actions and window routing

That suggests a separate tool could maintain a simple model like:

```text
Project A -> window 0, tab 2
Project B -> window 0, tab 5
Project C -> window 1, tab 1
```

and then invoke Terminal commands to:

- create project tabs
- focus the tab for a project
- open a project in a dedicated window

### What that companion app could prove quickly

Without forking Terminal, you could test:

- whether the "project switcher" idea is actually useful
- whether projects should map to tabs, pane trees, or windows
- whether users want one Terminal window per project or one window with grouped tabs
- how much persistence you need

### Limits of the companion path

It will hit hard limits quickly:

- no native in-Terminal project UI
- no control over internal tab rendering
- no robust way to treat hidden tab groups as a first-class concept
- likely brittle index/name mapping unless you add your own conventions
- limited introspection compared to changing Terminal itself

So I would treat this as:

- a **prototype path**
- a **workflow validation tool**
- not the ideal long-term implementation if you want the result to feel like part of Terminal

## Option 3: fork Windows Terminal

### Short answer

**This is the most viable path by far** if the goal is a Terminal-native "Project Window Manager"-like experience.

### Why the fork makes sense

Because once you narrow the scope to Windows Terminal only, the hardest parts are already solved by the host application:

1. **content ownership**
   - Terminal owns the terminal session/control stack

2. **logical model**
   - Terminal already has a tab model and switching model

3. **routing**
   - Terminal already knows how to target windows and tabs

4. **future expansion**
   - if you ever want more advanced moves later, Terminal already has internal content detach/reattach support

5. **no foreign HWNDs**
   - no `SetParent` fragility
   - no wrapper window problems
   - no UWP embedding weirdness
   - no cross-process UI ownership issues

This is exactly why a terminal-only version is a much better starting point.

### What the feature should become conceptually

I would not describe it as "hoisting windows" inside Terminal.

I would describe it as:

- a **project/workspace switcher**
- where each project owns one or more Terminal tabs or pane trees
- and the window switches between those project-owned content groups

That is much closer to Terminal's architecture.

### Recommended minimal v1 scope

To keep this realistic, I would scope v1 like this:

- single Windows Terminal window only
- no drag/drop
- no tear-out
- no cross-window attach/move
- no attempt to preserve Chromium-like UX
- no general plugin system

The feature is just:

1. create named projects/workspaces
2. associate tabs or pane layouts with each project
3. switch active project
4. restore the last active tab for that project

That is enough to resemble Project Window Manager conceptually, without taking on Terminal's hardest window-movement problems.

### Two realistic fork designs

### Design A: lightweight project grouping on top of tabs

This is the safest first version.

Add a higher-level concept like:

```cpp
struct ProjectWorkspace
{
    winrt::hstring Id;
    winrt::hstring Name;
    Windows::Foundation::Collections::IVector<TerminalApp::Tab> Tabs;
    uint32_t LastFocusedTabIndex;
};
```

Then add:

- a project collection per `TerminalWindow` / `TerminalPage`
- an active project ID
- commands like `switch-project`
- a small UI entry point such as a command palette command, dropdown, or sidebar

Switching a project could mean:

- show the tabs that belong to that project
- restore focus to the last selected tab in that project

This is the most Project-Window-Manager-like interpretation inside Terminal.

### Design B: simpler launcher/focuser over existing tabs

This is even easier.

Instead of making project groups fully change visible tab collections, just store metadata:

- project -> list of tab identities
- project -> last active tab

Then when the user switches project:

- select the last active tab in that project
- optionally jump through the command palette or custom action

This is less impressive visually, but much easier to ship first.

If you want a fast proof of concept, I would start here.

### What code paths look most reusable

The most relevant local code for a forked implementation is:

- `src\cascadia\TerminalApp\TabManagement.cpp`
  - central tab selection logic
  - `_SelectTab(...)`

- `src\cascadia\TerminalApp\TerminalPage.h`
  - logical `_tabs` collection

- `src\cascadia\TerminalApp\AppCommandlineArgs.cpp`
  - `-w,--window`
  - `focus-tab`

- `src\cascadia\TerminalApp\CommandPalette.cpp`
  - existing command-driven switching model

- `src\cascadia\TerminalApp\TerminalWindow.cpp`
  - persisted layout loading hooks

- `src\cascadia\TerminalApp\ContentManager.h`
  - useful later if you ever want to preserve content across more complex host transitions

For your reduced scope, I would expect most of the first implementation to live in:

- `TerminalPage`
- `TabManagement.cpp`
- command/action plumbing
- settings/state persistence

not in the advanced drag/drop or tear-out paths.

### Why a fork is better than an extension for this exact feature

Because the feature you want is not just "provide data to Terminal."

It is:

- add a new state model
- add switching behavior
- likely add new commands
- maybe add new UI affordances
- maybe change which tabs are visible in a given state

That is application behavior, not settings decoration.

So the boundary is pretty clear:

- **fragments/extensions** are for feeding Terminal configuration
- **a fork** is for changing Terminal behavior and UI model

### Biggest risks of the fork path

It is viable, but it is not free.

Main risks:

1. **upstream maintenance**
   - Windows Terminal is large and active
   - custom UI/state model changes will need rebasing

2. **tab model assumptions**
   - a lot of code likely assumes one `_tabs` collection is the active truth for the window
   - hiding/filtering/switching project-level groups may touch more code than it first appears

3. **state persistence**
   - deciding what a "project" persists is non-trivial
   - just tabs?
   - pane layout too?
   - cwd/environment/profile?

4. **resource usage**
   - if inactive projects keep live sessions around, memory/CPU stays allocated

5. **feature creep**
   - if you later add drag/drop, tear-out, cross-window moves, and saved workspaces all at once, the scope grows quickly

None of those make the fork a bad idea.

They just mean the first version should stay small.

## My recommendation

### Final answer

If you want this to **resemble Project Window Manager inside Terminal**, then:

- **do not pursue a plugin/extension as the main path**
- **do pursue either a small external companion spike or a fork**
- **choose a fork for the actual product direction**

### Best practical plan

#### Best long-term path

Fork Windows Terminal and build a **project/workspace switcher** on top of tabs.

#### Best low-risk first move

Before doing deep UI work, build a tiny proof of concept around:

- project metadata
- tab grouping
- project switch command
- restoring the last active tab for a project

No drag/drop. No cross-window movement. No content reattachment tricks.

Just:

> "Switch this Terminal window between named groups of Terminal-owned sessions."

That is the cleanest possible first step.

#### Best pre-fork spike

If you want to validate the workflow with minimal code churn first, build a small companion tool that drives:

- `wt -w ...`
- `focus-tab`
- `new-tab`

Then, if the workflow proves useful, move the concept into a Terminal fork where the UX can become native.

## Bottom line

For a **terminal-only** version of Project Window Manager:

- **plugin/extension:** weak path
- **external companion:** good spike path
- **fork of Windows Terminal:** best real implementation path

And because Terminal owns its own content, this idea is **far more viable** than trying to hoist arbitrary third-party windows in the current app.

## References

- `docs\inspiration\windows-terminal.md`
- `src\cascadia\TerminalSettingsModel\CascadiaSettingsSerialization.cpp`
- `src\cascadia\TerminalSettingsModel\CascadiaSettings.h`
- `src\cascadia\TerminalApp\AppCommandlineArgs.cpp`
- `src\cascadia\TerminalApp\TabManagement.cpp`
- `src\cascadia\TerminalApp\TerminalPage.h`
- `src\cascadia\TerminalApp\TerminalWindow.cpp`
- `src\cascadia\TerminalApp\ContentManager.h`
