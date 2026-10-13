# Native split feasibility spike

2026-10-13. Temporary browser-only layout probes; not a production extension.
Goal: a single native focal post on the left (including media and native actions), with composer and subsequent native content on the right. No private API calls, auth bridges, cloned React subtrees, or account writes.

First probe preserves DOM parentage and moves only the focal article's visual layout using CSS. Verify independent scroll, native image/video/menu interactions, and focal retention during deep native-list scrolling. Reload removes all probe changes.
