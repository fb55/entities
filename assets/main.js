// Search, the `/` shortcut, and the table of contents' current section.
const { base } = document.body.dataset;
/** @type {HTMLDialogElement} */
const dialog = document.querySelector("#Search");
const input = dialog.querySelector("input");
const results = dialog.querySelector(".results");
// Results on the current page only change the fragment.
results.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("a")) {
    dialog.close();
  }
});

/** @type {Promise<{ name: string; kind: string; url: string; parent?: string }[]> | undefined} */
let index;

/**
 * @param {string} query What to search for.
 */
async function search(query) {
  // A failed request is made again on the next search.
  index ??= fetch(`${base}assets/search.json`)
    .then((response) => {
      if (!response.ok) throw new Error(response.statusText);
      return response.json();
    })
    .catch((/** @type {unknown} */ e) => {
      index = undefined;
      const item = document.createElement("li");
      item.textContent = "Search could not be loaded. Try again.";
      results.replaceChildren(item);
      throw e;
    });
  const entries = await index;
  const needle = query.trim().toLowerCase();
  if (input.value.trim().toLowerCase() !== needle) return;
  const matches = needle
    ? entries.flatMap((entry) => {
        // Members are found by their names, and as `Parent.member`.
        const name = entry.name.toLowerCase();
        const full =
          entry.parent === undefined
            ? name
            : `${entry.parent.toLowerCase()}.${name}`;
        if (!full.includes(needle)) return [];
        return [
          {
            entry,
            isPrefix: name.startsWith(needle) || full.startsWith(needle),
          },
        ];
      })
    : [];
  // Names starting with the query first, then shorter names.
  matches.sort(
    (left, right) =>
      Number(right.isPrefix) - Number(left.isPrefix) ||
      left.entry.name.length - right.entry.name.length,
  );
  if (needle && matches.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No results";
    results.replaceChildren(item);
    return;
  }
  results.replaceChildren(
    ...matches.slice(0, 20).map(({ entry }) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      // URLs are relative to the site, or absolute for dependencies.
      link.href = new URL(entry.url, new URL(base, location.href)).href;
      const name = document.createElement("span");
      if (entry.parent !== undefined) {
        const parent = document.createElement("span");
        parent.className = "result-parent";
        parent.textContent = `${entry.parent}.`;
        // Long qualified names break after their parent's name.
        parent.append(document.createElement("wbr"));
        name.append(parent);
      }
      name.append(entry.name);
      const kind = document.createElement("span");
      kind.className = "result-kind";
      kind.textContent = entry.kind;
      kind.dataset.kind = entry.kind;
      link.append(name, kind);
      item.append(link);
      return item;
    }),
  );
}

input.addEventListener("input", () => {
  search(input.value).catch(reportError);
});
input.addEventListener("keydown", (event) => {
  // Enter also ends input methods' compositions.
  if (event.key === "Enter" && !event.isComposing) {
    results.querySelector("a")?.click();
  } else if (event.key === "ArrowDown" && !event.isComposing) {
    event.preventDefault();
    results.querySelector("a")?.focus();
  }
});
// Arrow keys move between results, and back to the input from the first.
results.addEventListener("keydown", (/** @type {KeyboardEvent} */ event) => {
  // Typing goes on in the input.
  if (
    (event.key.length === 1 || event.key === "Backspace") &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    input.focus();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const links = [...results.querySelectorAll("a")];
  const position = links.indexOf(
    /** @type {HTMLAnchorElement} */ (event.target),
  );
  if (position === -1) return;
  event.preventDefault();
  const next = position + (event.key === "ArrowDown" ? 1 : -1);
  (next < 0 ? input : links[Math.min(next, links.length - 1)]).focus();
});
dialog.addEventListener("close", () => {
  input.value = "";
  results.replaceChildren();
});

// A modified shortcut, which typing and dictation cannot trigger.
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "k" && !dialog.open) {
    event.preventDefault();
    dialog.showModal();
  }
});

// Pages of these docs that a reader points at load ahead, where browsers
// can: only through links typeref made, never through authored ones, which
// may lead to an application on the same origin.
if (HTMLScriptElement.supports?.("speculationrules")) {
  const rules = document.createElement("script");
  rules.type = "speculationrules";
  rules.textContent = JSON.stringify({
    prerender: [
      {
        where: {
          and: [
            // The pages typeref wrote, under these docs' path.
            {
              href_matches: {
                pathname: `${new URL(base, location.href).pathname}*.html`,
              },
            },
            {
              selector_matches:
                ".site a, .toc a, dl.index dt a, code a.n, .results a",
            },
          ],
        },
        eagerness: "moderate",
      },
    ],
  });
  document.head.append(rules);
}

// Apple's keyboards show the shortcut with Command.
if (/Mac|iPhone|iPad/u.test(navigator.platform)) {
  const key = document.querySelector(".search-button kbd");
  if (key) key.textContent = "⌘K";
}

/**
 * @param {HTMLElement} element An element in a scrolling list.
 * @param {HTMLElement} list The list.
 * @returns The element's offset from the top of the list's content.
 */
function offsetIn(element, list) {
  return element.offsetParent === list
    ? element.offsetTop
    : element.offsetTop - list.offsetTop;
}

/**
 * Scrolls a list to an element, if it is not wholly in view.
 *
 * @param {HTMLElement} element An element in the list.
 * @param {HTMLElement} list The list.
 */
function reveal(element, list) {
  const top = offsetIn(element, list);
  if (
    top < list.scrollTop ||
    top + element.offsetHeight > list.scrollTop + list.clientHeight
  ) {
    list.scrollTop = top - list.clientHeight / 2;
  }
}

/**
 * @param {string} query A media query.
 * @param {(matches: boolean) => void} listener Called with whether it
 *   matches, now and when that changes.
 */
function whenMatches(query, listener) {
  const list = matchMedia(query);
  listener(list.matches);
  list.addEventListener("change", () => {
    listener(list.matches);
  });
}

// The navigation is a sidebar, or on narrow screens a drawer.
const site = document.querySelector("#Site");
const narrow = matchMedia("(width < 60rem)");
if (site instanceof HTMLElement) {
  /** Scrolls the navigation, not the page, to the current page's link. */
  const showCurrent = () => {
    const current = site.querySelector("[aria-current=page]");
    if (current instanceof HTMLElement) reveal(current, site);
  };
  // The drawer is modal: the page behind it is inert while it is open.
  const page = document.querySelectorAll(
    "body > :not(.layout, dialog), .layout > :not(#Site)",
  );
  // Before closing, so focus can return to the button that opened it.
  site.addEventListener("beforetoggle", (event) => {
    const isOpening = event.newState === "open";
    for (const element of page) {
      if (element instanceof HTMLElement) element.inert = isOpening;
    }
  });
  site.addEventListener("toggle", (event) => {
    if (event.newState === "open") {
      showCurrent();
      site.querySelector("button")?.focus();
    }
  });
  whenMatches(narrow.media, (matches) => {
    if (!matches && site.matches(":popover-open")) site.hidePopover();
    if (!matches) showCurrent();
  });
}

// The table of contents is a column on wide screens, and above the page,
// collapsed, on others.
const contents = document.querySelector(".toc details");
if (contents instanceof HTMLDetailsElement) {
  const summary = contents.querySelector("summary");
  const wide = matchMedia("(width >= 80rem)");
  whenMatches(wide.media, (matches) => {
    contents.open = matches;
    // As a column, its summary is a heading, not a control.
    if (summary) summary.tabIndex = matches ? -1 : 0;
  });
  summary?.addEventListener("click", (event) => {
    if (wide.matches) event.preventDefault();
  });
  // Above the page, it closes once a section is chosen, or on leaving it.
  contents.addEventListener("click", (event) => {
    if (
      !wide.matches &&
      event.target instanceof Element &&
      event.target.closest("a")
    ) {
      contents.open = false;
    }
  });
  document.addEventListener("click", (event) => {
    if (
      !wide.matches &&
      contents.open &&
      event.target instanceof Node &&
      !contents.contains(event.target)
    ) {
      contents.open = false;
    }
  });
  // Keyboards leaving it close it too, so it covers nothing they reach.
  // Clicks within it, on headings or its scrollbar, focus nothing.
  contents.addEventListener("focusout", (event) => {
    if (
      !wide.matches &&
      contents.open &&
      event.relatedTarget instanceof Node &&
      !contents.contains(event.relatedTarget)
    ) {
      contents.open = false;
    }
  });
  contents.addEventListener("keydown", (event) => {
    if (!wide.matches && event.key === "Escape") {
      contents.open = false;
      summary?.focus();
    }
  });
}

/**
 * Mirrors the section in view, which CSS highlights, for assistive technology,
 * and keeps it in view in the contents' list.
 */
function syncCurrent() {
  const current = document.querySelector(".toc a:target-current");
  for (const link of document.querySelectorAll(".toc a")) {
    link.setAttribute("aria-current", String(link === current));
  }
  const list = current?.closest(".toc-list");
  if (
    current instanceof HTMLElement &&
    list instanceof HTMLElement &&
    list.clientHeight > 0
  ) {
    reveal(current, list);
  }
}

if (CSS.supports("scroll-target-group: auto")) {
  // The section in view updates after scrolling ends.
  const sync = () => {
    setTimeout(syncCurrent, 0);
  };
  sync();
  document.addEventListener("scrollend", sync);
  addEventListener("hashchange", sync);
}

export {};
