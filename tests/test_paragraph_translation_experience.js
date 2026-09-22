const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

let selectionAnchorHelpers = {};
try {
  selectionAnchorHelpers = require('../extension/selection_anchor.js');
} catch (error) {
  // Individual tests below report the missing public API as assertion failures.
}

const { createRangeAnchor, isSelectionNavigationKey } = selectionAnchorHelpers;

test('exports the selection anchor helpers', () => {
  assert.equal(typeof createRangeAnchor, 'function');
  assert.equal(typeof isSelectionNavigationKey, 'function');
  assert.equal(globalThis.PaperDictSelectionAnchor, selectionAnchorHelpers);
});

test('rejects missing or unusable ranges', () => {
  assert.equal(createRangeAnchor(null), null);
  assert.equal(createRangeAnchor({}), null);
});

test('ignores keyboard events whose key is missing or not a string', () => {
  assert.equal(typeof isSelectionNavigationKey, 'function');
  assert.equal(isSelectionNavigationKey({}), false);
  assert.equal(isSelectionNavigationKey({ key: null }), false);
  assert.equal(isSelectionNavigationKey({ key: 42 }), false);
});

test('recognizes Shift and Arrow navigation keys', () => {
  assert.equal(typeof isSelectionNavigationKey, 'function');
  assert.equal(isSelectionNavigationKey({ key: 'Shift' }), true);
  assert.equal(isSelectionNavigationKey({ key: 'ArrowLeft' }), true);
  assert.equal(isSelectionNavigationKey({ key: 'ArrowDown' }), true);
  assert.equal(isSelectionNavigationKey({ key: 'Enter' }), false);
});

test('range anchors clone the range and read live rectangles', () => {
  assert.equal(typeof createRangeAnchor, 'function');
  let cloneCalls = 0;
  let rect = { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 };
  const clonedRange = {
    getBoundingClientRect() { return rect; }
  };
  const sourceRange = {
    cloneRange() {
      cloneCalls++;
      return clonedRange;
    },
    getBoundingClientRect() {
      throw new Error('the source range must not be read when cloning succeeds');
    }
  };

  const anchor = createRangeAnchor(sourceRange);
  assert.equal(cloneCalls, 1);
  assert.deepEqual(anchor.getRect(300, 200), rect);

  rect = { left: 25, top: 35, right: 125, bottom: 55, width: 100, height: 20 };
  assert.deepEqual(anchor.getRect(300, 200), rect);
});

test('range anchors reject invalid, empty, and fully offscreen rectangles', () => {
  assert.equal(typeof createRangeAnchor, 'function');
  let rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  const range = {
    cloneRange() { return this; },
    getBoundingClientRect() {
      if (rect instanceof Error) throw rect;
      return rect;
    }
  };
  const anchor = createRangeAnchor(range);

  assert.equal(anchor.getRect(300, 200), null);
  rect = { left: 310, top: 20, right: 410, bottom: 40, width: 100, height: 20 };
  assert.equal(anchor.getRect(300, 200), null);
  rect = { left: -110, top: 20, right: -10, bottom: 40, width: 100, height: 20 };
  assert.equal(anchor.getRect(300, 200), null);
  rect = { left: 10, top: 210, right: 110, bottom: 230, width: 100, height: 20 };
  assert.equal(anchor.getRect(300, 200), null);
  rect = { left: 10, top: -30, right: 110, bottom: -10, width: 100, height: 20 };
  assert.equal(anchor.getRect(300, 200), null);
  rect = { left: NaN, top: 10, right: 110, bottom: 30, width: 100, height: 20 };
  assert.equal(anchor.getRect(300, 200), null);
  rect = new Error('detached range');
  assert.equal(anchor.getRect(300, 200), null);
});

test('range anchors reject disconnected boundaries and mismatched selections', () => {
  const selectedNode = { isConnected: true };
  const otherNode = { isConnected: true };
  const range = {
    startContainer: selectedNode,
    endContainer: selectedNode,
    commonAncestorContainer: selectedNode,
    startOffset: 1,
    endOffset: 4,
    cloneRange() {
      return {
        startContainer: selectedNode,
        endContainer: selectedNode,
        commonAncestorContainer: selectedNode,
        startOffset: 1,
        endOffset: 4,
        getBoundingClientRect: () => ({
          left: 10, top: 10, right: 40, bottom: 30, width: 30, height: 20
        })
      };
    },
    getBoundingClientRect() { return this.cloneRange().getBoundingClientRect(); }
  };
  const anchor = createRangeAnchor(range);
  const currentSelection = { rangeCount: 1, isCollapsed: false, getRangeAt: () => range };

  assert.equal(anchor.matchesSelection(currentSelection), true);
  assert.equal(anchor.matchesSelection({ ...currentSelection, isCollapsed: true }), false);
  assert.equal(anchor.matchesSelection({
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => ({ ...range, startContainer: otherNode })
  }), false);

  range.startOffset = 2;
  assert.equal(anchor.matchesSelection(currentSelection), false);
  range.startOffset = 1;

  selectedNode.isConnected = false;
  assert.equal(anchor.matchesSelection(currentSelection), false);
  assert.equal(anchor.getRect(300, 200), null);
});

test('range anchor disposal detaches the cloned range when supported', () => {
  assert.equal(typeof createRangeAnchor, 'function');
  let detachCalls = 0;
  const clonedRange = {
    detach() { detachCalls++; },
    getBoundingClientRect() {
      return { left: 10, top: 10, right: 40, bottom: 30, width: 30, height: 20 };
    }
  };
  const anchor = createRangeAnchor({ cloneRange() { return clonedRange; } });

  anchor.dispose();
  anchor.dispose();
  assert.equal(detachCalls, 1);
  assert.equal(anchor.getRect(300, 200), null);
});

const {
  AcademicFilter,
  PaperBilingualManager,
  getAriaRoleTokens,
  isLinkElement
} = require('../extension/bilingual.js');

function createAcademicClassList(className = '') {
  const values = new Set(String(className).split(/\s+/).filter(Boolean));
  return {
    contains(name) { return values.has(name); }
  };
}

function matchesAcademicSelector(element, selector) {
  const simpleSelector = selector.trim();
  const tagMatch = simpleSelector.match(/^[a-z0-9-]+/i);
  if (tagMatch && element.tagName !== tagMatch[0].toUpperCase()) return false;

  const classMatch = simpleSelector.match(/\.([a-z0-9_-]+)/i);
  if (classMatch && !element.classList.contains(classMatch[1])) return false;

  const attributeMatch = simpleSelector.match(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/);
  if (attributeMatch) {
    const actual = element.getAttribute(attributeMatch[1]);
    if (actual === null) return false;
    if (attributeMatch[2] !== undefined && actual !== attributeMatch[2]) return false;
  }

  return Boolean(tagMatch || classMatch || attributeMatch);
}

function createAcademicElement(tagName, text, options = {}) {
  const attributes = { ...(options.attributes || {}) };
  if (options.role) attributes.role = options.role;
  const element = {
    tagName: String(tagName).toUpperCase(),
    _ownText: String(text || ''),
    id: options.id || '',
    className: options.className || '',
    classList: createAcademicClassList(options.className),
    dataset: options.dataset || {},
    parentElement: options.parentElement || null,
    children: [],
    hidden: Boolean(options.hidden),
    _computedStyle: options.computedStyle || null,
    _queryStats: options.queryStats || null,
    offsetParent: options.hidden ? null : {},
    offsetHeight: options.hidden ? 0 : 40,
    offsetWidth: options.hidden ? 0 : 400,
    get innerText() {
      const style = this._computedStyle || {};
      if (
        this.hidden ||
        String(style.display || '').toLowerCase() === 'none' ||
        ['hidden', 'collapse'].includes(String(style.visibility || '').toLowerCase())
      ) {
        return '';
      }
      return [this._ownText, ...this.children.map((child) => child.innerText)]
        .filter(Boolean)
        .join(' ')
        .trim();
    },
    set innerText(value) { this._ownText = String(value || ''); },
    get textContent() {
      return [this._ownText, ...this.children.map((child) => child.textContent)]
        .filter(Boolean)
        .join(' ')
        .trim();
    },
    set textContent(value) { this._ownText = String(value || ''); },
    getAttribute(name) {
      if (name === 'class') return this.className || null;
      if (name === 'id') return this.id || null;
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    appendChild(child) {
      child.parentElement = this;
      if (!child._queryStats) child._queryStats = this._queryStats;
      this.children.push(child);
      return child;
    },
    querySelectorAll(selector) {
      if (this._queryStats) this._queryStats.push({ element: this, selector: String(selector) });
      const selectors = String(selector).split(',');
      const descendants = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (selectors.some((item) => matchesAcademicSelector(child, item))) descendants.push(child);
          visit(child);
        }
      };
      visit(this);
      return descendants;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  };
  return element;
}

function withAcademicDom(run) {
  const previousDocument = global.document;
  const previousWindow = global.window;
  const body = createAcademicElement('BODY', '');
  const documentElement = createAcademicElement('HTML', '');
  global.document = { body, documentElement };
  global.window = {
    getComputedStyle(element) {
      return element._computedStyle || { display: 'block', visibility: 'visible' };
    }
  };
  try {
    return run({ body, documentElement });
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

test('academic filtering preserves legacy blocks and inline links', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const paragraph = createAcademicElement(
    'P',
    'This paragraph keeps its inline citation link while remaining translatable.'
  );
  paragraph.appendChild(createAcademicElement('A', 'supporting citation'));

  assert.equal(filter.isEligible(paragraph), true);
  for (const tag of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) {
    assert.equal(filter.isEligible(createAcademicElement(tag, `${tag} Methods`)), true, tag);
  }
  assert.equal(filter.isEligible(createAcademicElement(
    'BLOCKQUOTE',
    'This quoted academic observation remains part of the article body.'
  )), true);
  assert.equal(filter.isEligible(createAcademicElement(
    'LI',
    'This list item reports a sufficiently detailed experimental result.'
  )), true);
}));

test('academic filtering accepts semantic and sufficiently long leaf divs', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const roleParagraph = createAcademicElement(
    'DIV',
    'The estimate remains statistically significant.',
    { role: 'paragraph' }
  );
  const classParagraph = createAcademicElement(
    'DIV',
    'Ablation results isolate the effect.',
    { className: 'article-text' }
  );
  const idParagraph = createAcademicElement(
    'DIV',
    'The cohort retained complete follow-up data.',
    { id: 'body-text-3' }
  );
  const longLeaf = createAcademicElement(
    'DIV',
    'This unhinted leaf block contains enough English prose to represent a complete academic paragraph.'
  );

  assert.equal(filter.isEligible(roleParagraph), true);
  assert.equal(filter.isEligible(classParagraph), true);
  assert.equal(filter.isEligible(idParagraph), true);
  assert.equal(filter.isEligible(longLeaf), true);
}));

test('academic filtering preserves prose divs with one inline link', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const paragraph = createAcademicElement(
    'DIV',
    'The analysis follows this method in detail.',
    { role: 'paragraph' }
  );
  paragraph.appendChild(createAcademicElement('A', 'detailed supplementary methodology', { role: 'link' }));

  assert.equal(filter.isCandidateTag(paragraph), true);
  assert.equal(filter.isEligible(paragraph), true);
}));

test('academic filtering preserves prose with one non-anchor ARIA link', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const paragraph = createAcademicElement(
    'DIV',
    'The analysis explains the complete experimental result and links to',
    { role: 'paragraph' }
  );
  paragraph.appendChild(createAcademicElement('SPAN', 'supplementary table', { role: 'link' }));

  assert.equal(filter.isCandidateTag(paragraph), true);
  assert.equal(filter.isEligible(paragraph), true);
}));

test('ARIA role tokens are normalized and identify fallback link roles', () => {
  const fallbackLink = createAcademicElement('SPAN', 'Methods', { role: 'unknown LINK' });
  const nativeLink = createAcademicElement('A', 'Results');

  assert.deepEqual(getAriaRoleTokens(fallbackLink), ['unknown', 'link']);
  assert.equal(isLinkElement(fallbackLink), true);
  assert.equal(isLinkElement(nativeLink), true);
  assert.equal(isLinkElement(createAcademicElement('SPAN', 'Plain text')), false);
});

test('contenteditable=false descendants do not block semantic divs', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const paragraph = createAcademicElement(
    'DIV',
    'This semantic paragraph contains a non-editable annotation and remains valid prose.',
    { role: 'paragraph' }
  );
  paragraph.appendChild(createAcademicElement(
    'SPAN',
    'fixed annotation',
    { attributes: { contenteditable: 'false' } }
  ));

  assert.equal(filter.isEligible(paragraph), true);
}));

test('academic filtering rejects div containers and interactive descendants', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const parent = createAcademicElement(
    'DIV',
    'This parent repeats the complete body text exposed by a more specific child paragraph.',
    { className: 'prose' }
  );
  parent.appendChild(createAcademicElement(
    'P',
    'This child paragraph is the specific translation candidate for the result.'
  ));
  const interactive = createAcademicElement(
    'DIV',
    'This prose block includes an interactive control and must not be translated.',
    { role: 'paragraph' }
  );
  interactive.appendChild(createAcademicElement('BUTTON', 'Show details'));

  assert.equal(filter.isEligible(parent), false);
  assert.equal(filter.isEligible(interactive), false);
}));

test('academic filtering rejects excluded ancestors, generated nodes, code, and math', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const generated = createAcademicElement(
    'DIV',
    'This generated translation must never become a translation source.',
    { className: 'pd-bilingual-trans', role: 'paragraph' }
  );
  const code = createAcademicElement('CODE', 'const academicModel = true;');
  const math = createAcademicElement('MATH', 'The formula x equals y plus z is represented here.');

  assert.equal(filter.isEligible(generated), false);
  assert.equal(filter.isEligible(code), false);
  assert.equal(filter.isEligible(math), false);
}));

test('academic filtering parametrically rejects excluded structural ancestors', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const cases = [
    { tag: 'PRE' },
    { tag: 'CODE' },
    { tag: 'MATH' },
    { tag: 'NAV' },
    { tag: 'HEADER' },
    { tag: 'FOOTER' },
    { tag: 'ASIDE' },
    { tag: 'FORM' },
    { tag: 'PAPER-DICT-HOST' },
    { tag: 'PAPERDICT-BILINGUAL-CAPSULE-HOST' },
    { tag: 'SECTION', className: 'references' },
    { tag: 'SECTION', id: 'bibliography-list' }
  ];

  for (const options of cases) {
    const ancestor = createAcademicElement(options.tag, '', options);
    const candidate = ancestor.appendChild(createAcademicElement(
      'DIV',
      'This eligible-looking English paragraph must be rejected because its ancestor is non-content.',
      { role: 'paragraph' }
    ));
    assert.equal(filter.isCandidateTag(candidate), true, JSON.stringify(options));
    assert.equal(filter.isEligible(candidate), false, JSON.stringify(options));
  }
}));

test('academic filtering rejects interactive and landmark ARIA roles on self or ancestors', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const roles = [
    'button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'combobox',
    'listbox', 'option', 'slider', 'spinbutton', 'progressbar', 'scrollbar',
    'tree', 'treeitem', 'grid', 'gridcell', 'row', 'rowgroup', 'application',
    'navigation', 'menu', 'menuitem', 'toolbar', 'tab', 'tablist', 'dialog',
    'search', 'form', 'banner', 'contentinfo', 'complementary'
  ];

  for (const role of roles) {
    const selfCandidate = createAcademicElement(
      'DIV',
      'This eligible-looking English block uses an interactive or landmark role and is not article prose.',
      { role }
    );
    assert.equal(filter.isCandidateTag(selfCandidate), true, `self role=${role}`);
    assert.equal(filter.isEligible(selfCandidate), false, `self role=${role}`);

    const ancestor = createAcademicElement('SECTION', '', { role });
    const nestedCandidate = ancestor.appendChild(createAcademicElement(
      'DIV',
      'This semantic English paragraph is nested inside a non-content ARIA landmark.',
      { role: 'paragraph' }
    ));
    assert.equal(filter.isCandidateTag(nestedCandidate), true, `ancestor role=${role}`);
    assert.equal(filter.isEligible(nestedCandidate), false, `ancestor role=${role}`);
  }
}));

test('academic filtering explicitly rejects missing WAI-ARIA widget and composite roles', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const selfMenuItemCheckbox = createAcademicElement(
    'DIV',
    'This eligible-looking menu item checkbox is a custom control rather than article prose.',
    { role: 'menuitemcheckbox' }
  );
  const selfSearchbox = createAcademicElement(
    'DIV',
    'This eligible-looking search box is a custom control rather than article prose.',
    { role: 'searchbox' }
  );
  const selfTreegrid = createAcademicElement(
    'DIV',
    'This eligible-looking tree grid is an interactive composite rather than article prose.',
    { role: 'treegrid' }
  );
  const selfMeter = createAcademicElement(
    'DIV',
    'This eligible-looking meter reports interface state rather than article prose.',
    { role: 'meter' }
  );
  const menuItemRadioAncestor = createAcademicElement('SECTION', '', { role: 'menuitemradio' });
  const nestedUnderMenuItemRadio = menuItemRadioAncestor.appendChild(createAcademicElement(
    'DIV',
    'This semantic paragraph is nested below a custom menu item radio control.',
    { role: 'paragraph' }
  ));
  const radioGroupAncestor = createAcademicElement('SECTION', '', { role: 'radiogroup' });
  const nestedUnderRadioGroup = radioGroupAncestor.appendChild(createAcademicElement(
    'DIV',
    'This semantic paragraph is nested below a custom radio group control.',
    { role: 'paragraph' }
  ));

  assert.equal(filter.isCandidateTag(selfMenuItemCheckbox), true);
  assert.equal(filter.isEligible(selfMenuItemCheckbox), false, 'menuitemcheckbox on self');
  assert.equal(filter.isCandidateTag(nestedUnderMenuItemRadio), true);
  assert.equal(filter.isEligible(nestedUnderMenuItemRadio), false, 'menuitemradio on ancestor');
  assert.equal(filter.isCandidateTag(selfSearchbox), true);
  assert.equal(filter.isEligible(selfSearchbox), false, 'searchbox on self');
  assert.equal(filter.isCandidateTag(nestedUnderRadioGroup), true);
  assert.equal(filter.isEligible(nestedUnderRadioGroup), false, 'radiogroup on ancestor');
  assert.equal(filter.isCandidateTag(selfTreegrid), true);
  assert.equal(filter.isEligible(selfTreegrid), false, 'treegrid on self');
  assert.equal(filter.isCandidateTag(selfMeter), true);
  assert.equal(filter.isEligible(selfMeter), false, 'meter on self');
}));

test('semantic divs reject descendant custom ARIA controls', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const paragraph = createAcademicElement(
    'DIV',
    'This semantic paragraph includes a custom setting control and must not be translated.',
    { role: 'paragraph' }
  );
  paragraph.appendChild(createAcademicElement('SPAN', 'Enable result', { role: 'menuitemcheckbox' }));

  assert.equal(filter.isSemanticParagraphDiv(paragraph), false);
  assert.equal(filter.isEligible(paragraph), false);
}));

test('academic filtering preserves harmless document and content roles', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const documentRegion = createAcademicElement('SECTION', '', { role: 'document' });
  const paragraph = documentRegion.appendChild(createAcademicElement(
    'DIV',
    'This article role contains ordinary English academic prose without interactive controls.',
    { role: 'article' }
  ));

  assert.equal(filter.isCandidateTag(paragraph), true);
  assert.equal(filter.isEligible(paragraph), true);
}));

test('academic filtering rejects link-only and link-dense div collections', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const linkOnly = createAcademicElement(
    'DIV',
    '',
    { role: 'paragraph' }
  );
  for (const label of ['Methods', 'Results', 'References']) {
    linkOnly.appendChild(createAcademicElement('A', label));
  }

  const linkDense = createAcademicElement(
    'DIV',
    'Browse these related research resources.',
    { role: 'paragraph' }
  );
  for (const label of ['Dataset', 'Model', 'Source', 'Evaluation']) {
    linkDense.appendChild(createAcademicElement('A', label));
  }

  const customLinkOnly = createAcademicElement(
    'DIV',
    '',
    { role: 'paragraph' }
  );
  for (const label of ['Methods', 'Results', 'References']) {
    customLinkOnly.appendChild(createAcademicElement('SPAN', label, { role: 'link' }));
  }

  const customLinkDense = createAcademicElement(
    'DIV',
    'Browse these related research resources.',
    { role: 'paragraph' }
  );
  for (const label of ['Dataset', 'Model', 'Source', 'Evaluation']) {
    customLinkDense.appendChild(createAcademicElement('SPAN', label, { role: 'link' }));
  }

  const fallbackRoleLinks = createAcademicElement(
    'DIV',
    '',
    { role: 'paragraph' }
  );
  for (const label of ['Methods', 'Results', 'References']) {
    fallbackRoleLinks.appendChild(createAcademicElement('SPAN', label, { role: 'unknown LINK' }));
  }

  for (const candidate of [linkOnly, linkDense, customLinkOnly, customLinkDense, fallbackRoleLinks]) {
    assert.equal(filter.isCandidateTag(candidate), true);
    assert.equal(filter.isEligible(candidate), false);
  }
}));

test('academic filtering rejects computed CSS hiding on self or ancestors', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const cases = [
    { location: 'self', computedStyle: { display: 'none', visibility: 'visible' } },
    { location: 'self', computedStyle: { display: 'block', visibility: 'hidden' } },
    { location: 'ancestor', computedStyle: { display: 'none', visibility: 'visible' } },
    { location: 'ancestor', computedStyle: { display: 'block', visibility: 'hidden' } }
  ];

  for (const item of cases) {
    const candidate = createAcademicElement(
      'DIV',
      'This eligible-looking English paragraph is hidden only through computed CSS.',
      { role: 'paragraph', computedStyle: item.location === 'self' ? item.computedStyle : null }
    );
    if (item.location === 'ancestor') {
      createAcademicElement('SECTION', '', { computedStyle: item.computedStyle }).appendChild(candidate);
    }
    assert.equal(filter.isCandidateTag(candidate), true, JSON.stringify(item));
    assert.equal(filter.isEligible(candidate), false, JSON.stringify(item));
  }
}));

test('academic filtering enforces English, visibility, and short metadata constraints', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  assert.equal(filter.isEligible(createAcademicElement('DIV', 'Published 2026')), false);
  assert.equal(filter.isEligible(createAcademicElement(
    'DIV',
    'This visible-looking metadata block is actually hidden from layout and must be skipped.',
    { hidden: true }
  )), false);
  assert.equal(filter.isEligible(createAcademicElement(
    'DIV',
    'This mixed paragraph 包含中文 and therefore cannot enter English translation.',
    { role: 'paragraph' }
  )), false);
  assert.equal(filter.isEligible(createAcademicElement(
    'DIV',
    '这是一段足够长但完全不是英语正文的中文内容，因此不能进入翻译队列。',
    { role: 'paragraph' }
  )), false);
}));

test('content discovery returns only leaf candidates and preserves reference boundaries', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const article = createAcademicElement('ARTICLE', '');
  const parent = article.appendChild(createAcademicElement(
    'DIV',
    'This aggregate article container repeats the full text of its semantic paragraph child.',
    { className: 'article-text' }
  ));
  const child = parent.appendChild(createAcademicElement(
    'DIV',
    'This unhinted leaf paragraph reports the primary result clearly in document order.'
  ));
  article.appendChild(createAcademicElement('H2', 'References'));
  article.appendChild(createAcademicElement(
    'DIV',
    'This reference entry is long enough to look like prose but remains excluded.',
    { role: 'paragraph' }
  ));
  const discussionHeading = article.appendChild(createAcademicElement('H2', 'Discussion'));
  const discussion = article.appendChild(createAcademicElement(
    'DIV',
    'This later semantic paragraph remains eligible after the reference section ends.',
    { className: 'body-text' }
  ));
  const root = {
    body: article,
    querySelector(selector) { return selector === 'article' ? article : null; }
  };

  assert.deepEqual(filter.findContentElements(root), [child, discussionHeading, discussion]);
}));

test('excluded reference headings do not change article reference traversal state', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const article = createAcademicElement('ARTICLE', '');
  const navigation = article.appendChild(createAcademicElement('NAV', ''));
  navigation.appendChild(createAcademicElement('H2', 'References'));
  const paragraph = article.appendChild(createAcademicElement(
    'P',
    'This visible article paragraph follows excluded navigation and remains translatable.'
  ));
  const root = {
    body: article,
    querySelector(selector) { return selector === 'article' ? article : null; }
  };

  assert.deepEqual(filter.findContentElements(root), [paragraph]);
}));

test('hidden or excluded div descendants do not suppress visible semantic parents', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const parentWithHiddenChild = createAcademicElement(
    'DIV',
    'This visible parent contains its own complete academic explanation.',
    { role: 'paragraph' }
  );
  const hiddenChild = parentWithHiddenChild.appendChild(createAcademicElement(
    'DIV',
    'This hidden child is long enough to resemble an independent academic paragraph.',
    { role: 'paragraph', hidden: true }
  ));
  const parentWithExcludedChild = createAcademicElement(
    'DIV',
    'This visible parent also contains its own complete academic explanation.',
    { role: 'paragraph' }
  );
  const excludedChild = parentWithExcludedChild.appendChild(createAcademicElement(
    'DIV',
    'This excluded reference child is long enough to resemble an independent academic paragraph.',
    { role: 'paragraph', className: 'references' }
  ));

  assert.equal(filter.isEligible(hiddenChild), false);
  assert.equal(filter.isEligible(parentWithHiddenChild), true);
  assert.equal(filter.isEligible(excludedChild), false);
  assert.equal(filter.isEligible(parentWithExcludedChild), true);
}));

test('content discovery ignores hidden control descendants', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const article = createAcademicElement('ARTICLE', '');
  const expected = [];
  const hiddenCases = [
    { hidden: true },
    { attributes: { 'aria-hidden': 'true' } },
    { computedStyle: { display: 'none', visibility: 'visible' } },
    { computedStyle: { display: 'block', visibility: 'hidden' } }
  ];
  for (const [index, options] of hiddenCases.entries()) {
    const paragraph = article.appendChild(createAcademicElement(
      'DIV',
      `This visible semantic paragraph ${index} remains valid when its optional control is hidden.`,
      { role: 'paragraph' }
    ));
    paragraph.appendChild(createAcademicElement('BUTTON', 'Show details', options));
    expected.push(paragraph);
  }
  const root = {
    body: article,
    querySelector(selector) { return selector === 'article' ? article : null; }
  };

  assert.deepEqual(filter.findContentElements(root), expected);
}));

test('content discovery ignores controls inside excluded descendant wrappers', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const article = createAcademicElement('ARTICLE', '');
  const paragraph = article.appendChild(createAcademicElement(
    'DIV',
    'This visible semantic paragraph remains valid beside excluded reference controls.',
    { role: 'paragraph' }
  ));
  const references = paragraph.appendChild(createAcademicElement('SECTION', '', { className: 'references' }));
  references.appendChild(createAcademicElement('BUTTON', 'Open citation'));
  const root = {
    body: article,
    querySelector(selector) { return selector === 'article' ? article : null; }
  };

  assert.deepEqual(filter.findContentElements(root), [paragraph]);
}));

test('content discovery excludes hidden links from link-density statistics', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const article = createAcademicElement('ARTICLE', '');
  const paragraph = article.appendChild(createAcademicElement(
    'DIV',
    'This visible semantic paragraph presents the complete academic result.',
    { role: 'paragraph' }
  ));
  for (const label of ['Dataset archive', 'Model source', 'Evaluation report', 'Related research']) {
    paragraph.appendChild(createAcademicElement('A', label, { hidden: true }));
  }
  const root = {
    body: article,
    querySelector(selector) { return selector === 'article' ? article : null; }
  };

  assert.equal(paragraph.innerText.includes('Dataset archive'), false);
  assert.equal(paragraph.textContent.includes('Dataset archive'), true);
  assert.deepEqual(filter.findContentElements(root), [paragraph]);
}));

test('content discovery still filters visible control and link descendants', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const article = createAcademicElement('ARTICLE', '');
  const interactive = article.appendChild(createAcademicElement(
    'DIV',
    'This semantic paragraph contains a visible control and must remain excluded.',
    { role: 'paragraph' }
  ));
  interactive.appendChild(createAcademicElement('BUTTON', 'Show details'));
  const linkDense = article.appendChild(createAcademicElement(
    'DIV',
    'Browse these related research resources.',
    { role: 'paragraph' }
  ));
  for (const label of ['Dataset', 'Model', 'Source', 'Evaluation']) {
    linkDense.appendChild(createAcademicElement('A', label));
  }
  const root = {
    body: article,
    querySelector(selector) { return selector === 'article' ? article : null; }
  };

  assert.deepEqual(filter.findContentElements(root), []);
}));

test('content discovery uses a bounded number of subtree queries', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const queryStats = [];
  const article = createAcademicElement('ARTICLE', '', { queryStats });
  const expected = [];
  for (let index = 0; index < 24; index++) {
    expected.push(article.appendChild(createAcademicElement(
      'DIV',
      `This semantic paragraph number ${index} contains enough English prose for translation.`,
      { role: 'paragraph' }
    )));
  }
  const root = {
    body: article,
    querySelector(selector) { return selector === 'article' ? article : null; }
  };

  assert.deepEqual(filter.findContentElements(root), expected);
  const candidateQueries = queryStats.filter(({ selector }) => {
    return selector.includes('p, h1, h2, h3, h4, h5, h6, blockquote, li, div');
  });
  assert.equal(candidateQueries.length, 1);
  assert(queryStats.length <= 2, `expected at most 2 subtree queries, received ${queryStats.length}`);
}));

function withSchedulingDom(options, run) {
  const previous = {
    document: global.document,
    window: global.window,
    IntersectionObserver: global.IntersectionObserver,
    MutationObserver: global.MutationObserver
  };
  const body = createAcademicElement('BODY', '');
  const documentElement = createAcademicElement('HTML', '');
  documentElement.dataset = {};
  global.document = { body, documentElement };
  global.window = {
    innerWidth: options.innerWidth || 800,
    innerHeight: options.innerHeight || 600,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
  };

  if (Object.prototype.hasOwnProperty.call(options, 'IntersectionObserver')) {
    global.IntersectionObserver = options.IntersectionObserver;
  } else {
    delete global.IntersectionObserver;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'MutationObserver')) {
    global.MutationObserver = options.MutationObserver;
  } else {
    delete global.MutationObserver;
  }

  const restore = () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete global[name];
      else global[name] = value;
    }
  };

  try {
    const result = run({ body, documentElement });
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function makeSchedulingElement(top = 20, bottom = 80, left = 10, right = 210, options = {}) {
  const element = createAcademicElement(
    options.tagName || 'P',
    Object.prototype.hasOwnProperty.call(options, 'text')
      ? options.text
      : 'This academic paragraph is long enough to enter the translation queue.',
    options
  );
  element.nodeType = 1;
  element.getBoundingClientRect = () => ({
    top,
    bottom,
    left,
    right,
    width: right - left,
    height: bottom - top
  });
  return element;
}

function createObserverDouble() {
  const instances = [];
  class ObserverDouble {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observed = [];
      this.unobserved = [];
      this.disconnectCalls = 0;
      this.observeCalls = [];
      instances.push(this);
    }

    observe(target, options) {
      this.observed.push(target);
      this.observeCalls.push({ target, options });
    }

    unobserve(target) {
      this.unobserved.push(target);
    }

    disconnect() {
      this.disconnectCalls++;
    }

    emit(records) {
      this.callback(records);
    }
  }
  return { ObserverDouble, instances };
}

function silenceTranslationPipeline(manager) {
  manager.processQueue = () => {};
  manager.renderLoadingPlaceholder = () => {};
  manager.applyDisplayModeToAll = () => {};
  manager.updateCapsuleStats = () => {};
}

function createTranslationNodeDouble(className = 'pd-bilingual-loading') {
  return {
    classList: createAcademicClassList(className),
    removed: false,
    remove() { this.removed = true; }
  };
}

function createMutableClassList(element, initial = '') {
  const values = new Set(String(initial).split(/\s+/).filter(Boolean));
  const sync = () => { element._className = [...values].join(' '); };
  sync();
  return {
    add(...names) { names.forEach((name) => values.add(name)); sync(); },
    remove(...names) { names.forEach((name) => values.delete(name)); sync(); },
    contains(name) { return values.has(name); }
  };
}

function createTranslationViewNode(className = '') {
  const node = {
    _className: '',
    innerHTML: '',
    style: {},
    parentNode: null,
    removed: false,
    retryButton: null,
    querySelector(selector) {
      if (selector !== '.pd-translation-retry' || !this.innerHTML.includes('pd-translation-retry')) {
        return null;
      }
      if (!this.retryButton) this.retryButton = { onclick: null };
      return this.retryButton;
    },
    remove() {
      this.removed = true;
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
      }
    }
  };
  node.classList = createMutableClassList(node, className);
  Object.defineProperty(node, 'className', {
    get() { return node._className; },
    set(value) { node.classList = createMutableClassList(node, value); }
  });
  return node;
}

function createTranslationViewHarness() {
  const container = {
    children: [],
    appendChild(node) {
      node.parentNode = this;
      this.children.push(node);
      return node;
    },
    insertBefore(node, sibling) {
      node.parentNode = this;
      const index = this.children.indexOf(sibling);
      if (index === -1) this.children.push(node);
      else this.children.splice(index, 0, node);
      return node;
    }
  };
  const source = {
    innerText: 'This academic paragraph has enough English text for translation.',
    textContent: 'This academic paragraph has enough English text for translation.',
    isConnected: true,
    parentNode: container,
    classList: null
  };
  source.classList = createMutableClassList(source);
  Object.defineProperty(source, 'nextSibling', {
    get() {
      const index = container.children.indexOf(source);
      return index === -1 ? null : container.children[index + 1] || null;
    }
  });
  container.appendChild(source);
  return { container, source };
}

function withTranslationViewDom(run) {
  const previousDocument = global.document;
  global.document = {
    createElement: () => createTranslationViewNode(),
    documentElement: { dataset: {} },
    querySelectorAll: () => []
  };
  try {
    const result = run();
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        if (previousDocument === undefined) delete global.document;
        else global.document = previousDocument;
      });
    }
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    return result;
  } catch (error) {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    throw error;
  }
}

function getCssRuleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

test('successful translations render one labeled block and preserve restored formula HTML', () => {
  withTranslationViewDom(() => {
    const { container, source } = createTranslationViewHarness();
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    const info = { state: 'done', transEl: null };
    const formulaHtml = '<span class="pd-math-formula"><math><mi>x</mi></math></span>';

    manager.renderTranslation(source, info, formulaHtml);
    const firstNode = info.transEl;
    manager.renderTranslation(source, info, formulaHtml);

    assert.equal(container.children.filter((node) => node !== source).length, 1);
    assert.equal(info.transEl, firstNode);
    assert.equal(info.transEl.classList.contains('pd-bilingual-trans'), true);
    assert.equal((info.transEl.innerHTML.match(/pd-translation-label/g) || []).length, 1);
    assert.match(info.transEl.innerHTML, /<div class="pd-translation-label">译文<\/div>/);
    assert.match(info.transEl.innerHTML, /<div class="pd-translation-content">/);
    assert(info.transEl.innerHTML.includes(formulaHtml));
  });
});

test('paired translation CSS uses the approved restrained green scheme', () => {
  const css = fs.readFileSync(path.join(__dirname, '../extension/bilingual.css'), 'utf8');
  const block = getCssRuleBody(css, '.pd-bilingual-trans');
  const label = getCssRuleBody(css, '.pd-translation-label');

  assert.match(block, /margin:\s*6px 0 18px\s*!important/);
  assert.match(block, /padding:\s*4px 0 4px 12px\s*!important/);
  assert.match(block, /background:\s*transparent\s*!important/);
  assert.match(block, /border-left:\s*3px solid #1c7c54\s*!important/i);
  assert.match(block, /border-radius:\s*0\s*!important/);
  assert.match(block, /box-shadow:\s*none\s*!important/);
  assert.match(block, /letter-spacing:\s*0\s*!important/);
  assert.match(label, /font-size:\s*11px\s*!important/);
  assert.match(label, /font-weight:\s*700\s*!important/);
  assert.match(label, /color:\s*#1c7c54\s*!important/i);
  assert.match(label, /letter-spacing:\s*0\s*!important/);

  const chineseBlock = getCssRuleBody(css, 'html[data-paperdict-mode="chinese"] .pd-bilingual-trans');
  assert.doesNotMatch(chineseBlock, /border-left:\s*none/);
  assert.doesNotMatch(chineseBlock, /font-size|line-height|font-family/);
});

test('Chinese mode hides only a done source with a real translation block', () => {
  const manager = new PaperBilingualManager();
  manager.mode = 'chinese';
  const cases = [
    ['idle', null, false],
    ['queued', createTranslationViewNode('pd-bilingual-loading'), false],
    ['translating', createTranslationViewNode('pd-bilingual-loading'), false],
    ['error', createTranslationViewNode('pd-bilingual-error'), false],
    ['done', createTranslationViewNode('pd-bilingual-loading'), false],
    ['done', createTranslationViewNode('pd-bilingual-trans'), true]
  ];
  manager.elements = cases.map(([state, transEl]) => {
    const source = { classList: null };
    source.classList = createMutableClassList(source);
    manager.elementStateMap.set(source, { state, transEl });
    return source;
  });

  manager.applyDisplayModeToAll();

  cases.forEach((entry, index) => {
    assert.equal(manager.elements[index].classList.contains('pd-orig-hidden'), entry[2], entry[0]);
  });
});

test('failed paragraphs enter error state, keep processing, and retry only on command', () => {
  return withTranslationViewDom(async () => {
    const first = createTranslationViewHarness();
    const second = createTranslationViewHarness();
    const responses = [
      { success: false, error: 'service unavailable' },
      { success: true, translation: '第二段译文' },
      { success: true, translation: '重试后的译文' }
    ];
    const manager = new PaperBilingualManager();
    manager.mode = 'chinese';
    manager.maxConcurrency = 1;
    manager.formulaProtector = {
      protect: (element) => ({ protectedText: element.innerText, tokenMap: new Map() }),
      restore: (translation) => translation,
      escapeHtml: (value) => String(value)
    };
    manager.requestTranslation = () => Promise.resolve(responses.shift());
    manager.updateCapsuleStats = () => {};
    for (const source of [first.source, second.source]) {
      manager.registeredElements.add(source);
      manager.elements.push(source);
      manager.elementStateMap.set(source, { state: 'idle', transEl: null });
      manager.enqueueElement(source);
    }

    await flushSchedulingPromises();
    await flushSchedulingPromises();
    const firstInfo = manager.elementStateMap.get(first.source);
    const secondInfo = manager.elementStateMap.get(second.source);
    assert.equal(firstInfo.state, 'error');
    assert.equal(firstInfo.transEl.classList.contains('pd-bilingual-error'), true);
    assert.equal(first.source.classList.contains('pd-orig-hidden'), false);
    assert.equal(secondInfo.state, 'done');
    assert.equal(second.source.classList.contains('pd-orig-hidden'), true);
    assert.equal(responses.length, 1, 'failure must not retry automatically');

    const errorNode = firstInfo.transEl;
    const retryButton = errorNode.querySelector('.pd-translation-retry');
    assert.equal(typeof retryButton.onclick, 'function');
    retryButton.onclick({ stopPropagation() {} });
    await flushSchedulingPromises();

    assert.equal(firstInfo.state, 'done');
    assert.equal(firstInfo.transEl, errorNode);
    assert.equal(firstInfo.transEl.classList.contains('pd-bilingual-trans'), true);
    assert.equal(first.source.classList.contains('pd-orig-hidden'), true);
    assert.equal(first.container.children.filter((node) => node !== first.source).length, 1);
  });
});

test('rejected paragraph requests become retryable errors without blocking later work', () => {
  return withTranslationViewDom(async () => {
    const first = createTranslationViewHarness();
    const second = createTranslationViewHarness();
    let requestCount = 0;
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.maxConcurrency = 1;
    manager.formulaProtector = {
      protect: (element) => ({ protectedText: element.innerText, tokenMap: new Map() }),
      restore: (translation) => translation,
      escapeHtml: (value) => String(value)
    };
    manager.requestTranslation = () => {
      requestCount++;
      return requestCount === 1
        ? Promise.reject(new Error('transport failed'))
        : Promise.resolve({ success: true, translation: '后续段落译文' });
    };
    manager.updateCapsuleStats = () => {};
    for (const source of [first.source, second.source]) {
      manager.registeredElements.add(source);
      manager.elements.push(source);
      manager.elementStateMap.set(source, { state: 'idle', transEl: null });
      manager.enqueueElement(source);
    }

    await flushSchedulingPromises();
    await flushSchedulingPromises();

    assert.equal(manager.elementStateMap.get(first.source).state, 'error');
    assert.equal(manager.elementStateMap.get(second.source).state, 'done');
    assert.equal(requestCount, 2);
  });
});

test('loading placeholder reuses an existing generated error node', () => {
  withTranslationViewDom(() => {
    const { container, source } = createTranslationViewHarness();
    const errorNode = createTranslationViewNode('pd-bilingual-error');
    errorNode.innerHTML = '<button class="pd-translation-retry">重试</button>';
    errorNode.style.display = 'none';
    container.appendChild(errorNode);
    const info = { state: 'queued', transEl: errorNode };
    const manager = new PaperBilingualManager();

    manager.renderLoadingPlaceholder(source, info);

    assert.equal(info.transEl, errorNode);
    assert.equal(errorNode.className, 'pd-bilingual-loading');
    assert.match(errorNode.innerHTML, /pd-loading-spinner/);
    assert.equal(errorNode.style.display, 'block');
    assert.equal(container.children.filter((node) => node !== source).length, 1);
  });
});

test('mode switching reuses one completed translation block and one label', () => {
  withTranslationViewDom(() => {
    const { container, source } = createTranslationViewHarness();
    const manager = new PaperBilingualManager();
    manager.showToast = () => {};
    manager.updateCapsuleStats = () => {};
    manager.filter = {
      findContentElements: () => [source],
      isEligible: () => true
    };
    manager.registeredElements.add(source);
    manager.elements = [source];
    const info = { state: 'done', transEl: null, requestId: null, requestGeneration: null };
    manager.elementStateMap.set(source, info);
    manager.renderTranslation(source, info, '稳定译文');
    const translationNode = info.transEl;

    manager.setMode('chinese');
    manager.setMode('bilingual');
    manager.setMode('chinese');

    assert.equal(info.transEl, translationNode);
    assert.equal(container.children.filter((node) => node !== source).length, 1);
    assert.equal((translationNode.innerHTML.match(/pd-translation-label/g) || []).length, 1);
    assert.equal(source.classList.contains('pd-orig-hidden'), true);
  });
});

test('original mode removes done, error, and loading nodes and resets their state', () => {
  const manager = new PaperBilingualManager();
  manager.mode = 'original';
  manager.updateCapsuleStats = () => {};
  const states = ['done', 'error', 'queued'];
  const nodes = states.map((state) => createTranslationViewNode(
    state === 'done' ? 'pd-bilingual-trans' :
      state === 'error' ? 'pd-bilingual-error' : 'pd-bilingual-loading'
  ));
  manager.elements = states.map((state, index) => {
    const source = { classList: null };
    source.classList = createMutableClassList(source, 'pd-orig-hidden');
    manager.elementStateMap.set(source, {
      state,
      requestId: index + 1,
      requestGeneration: 4,
      requestEntry: null,
      transEl: nodes[index]
    });
    return source;
  });
  manager.queue = [manager.elements[2]];

  manager.restoreOriginalView();

  manager.elements.forEach((source, index) => {
    const info = manager.elementStateMap.get(source);
    assert.equal(nodes[index].removed, true, states[index]);
    assert.equal(info.state, 'idle', states[index]);
    assert.equal(info.requestId, null, states[index]);
    assert.equal(info.requestGeneration, null, states[index]);
    assert.equal(info.transEl, null, states[index]);
    assert.equal(source.classList.contains('pd-orig-hidden'), false, states[index]);
  });
});

test('original mode resets a completed source omitted by a later rescan', () => {
  const manager = new PaperBilingualManager();
  manager.mode = 'bilingual';
  manager.processQueue = () => {};
  manager.renderLoadingPlaceholder = () => {};
  manager.filter = { isEligible: () => true };
  const source = makeSchedulingElement();
  manager.registerElement(source);
  const info = manager.elementStateMap.get(source);
  const translationNode = createTranslationViewNode('pd-bilingual-trans');
  info.state = 'done';
  info.requestId = 7;
  info.requestGeneration = 2;
  info.transEl = translationNode;

  manager.queue = [];
  manager.elements = [];
  manager.registeredElements.clear();
  manager.mode = 'original';
  manager.restoreOriginalView();

  assert.equal(translationNode.removed, true);
  assert.equal(info.state, 'idle');
  assert.equal(info.requestId, null);
  assert.equal(info.requestGeneration, null);
  assert.equal(info.transEl, null);
});

test('generated error blocks are excluded from academic translation discovery', () => withAcademicDom(() => {
  const filter = new AcademicFilter();
  const error = createAcademicElement(
    'DIV',
    'Translation unavailable retry control must never become source material.',
    { className: 'pd-bilingual-error', role: 'paragraph' }
  );

  assert.equal(filter.isGeneratedNode(error), true);
  assert.equal(filter.isEligible(error), false);
}));

async function flushSchedulingPromises() {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

test('viewport scheduling uses strict rectangle overlap with both window dimensions', () => {
  withSchedulingDom({ innerWidth: 800, innerHeight: 600 }, () => {
    const manager = new PaperBilingualManager();
    assert.equal(manager.isElementInViewport(makeSchedulingElement(20, 80, 10, 210)), true);
    assert.equal(manager.isElementInViewport(makeSchedulingElement(-20, 1, 10, 210)), true);
    assert.equal(manager.isElementInViewport(makeSchedulingElement(599, 620, 10, 210)), true);
    assert.equal(manager.isElementInViewport(makeSchedulingElement(20, 80, -20, 1)), true);
    assert.equal(manager.isElementInViewport(makeSchedulingElement(20, 80, 799, 820)), true);
    assert.equal(manager.isElementInViewport(makeSchedulingElement(20, 80, 10, 210)), true);
    assert.equal(manager.isElementInViewport(makeSchedulingElement(-20, 0, 10, 210)), false);
    assert.equal(manager.isElementInViewport(makeSchedulingElement(600, 620, 10, 210)), false);
    assert.equal(manager.isElementInViewport(makeSchedulingElement(20, 80, -20, 0)), false);
    assert.equal(manager.isElementInViewport(makeSchedulingElement(20, 80, 800, 820)), false);
    assert.equal(manager.isElementInViewport(null), false);
  });
});

test('activation immediately queues visible elements and observes offscreen elements', () => {
  withSchedulingDom({}, () => {
    const visible = makeSchedulingElement(20, 80);
    const offscreen = makeSchedulingElement(900, 960);
    const observed = [];
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.filter = {
      findContentElements: () => [visible, offscreen],
      isEligible: () => true
    };
    manager.observer = { disconnect() {}, observe: (element) => observed.push(element) };
    silenceTranslationPipeline(manager);

    manager.activateBilingualView();

    assert.deepEqual(manager.queue, [visible]);
    assert.deepEqual(observed, [offscreen]);
    assert.deepEqual(manager.elements, [visible, offscreen]);
  });
});

test('intersection enqueues an observed paragraph once and then unobserves it', () => {
  const intersection = createObserverDouble();
  withSchedulingDom({ IntersectionObserver: intersection.ObserverDouble }, () => {
    const paragraph = makeSchedulingElement(900, 960);
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.filter = { isEligible: () => true };
    silenceTranslationPipeline(manager);
    manager.setupObserver();
    manager.registerElement(paragraph);

    const observer = intersection.instances[0];
    assert.deepEqual(observer.observed, [paragraph]);
    observer.emit([{ isIntersecting: true, target: paragraph }]);
    observer.emit([{ isIntersecting: true, target: paragraph }]);

    assert.deepEqual(manager.queue, [paragraph]);
    assert(observer.unobserved.includes(paragraph));
  });
});

test('duplicate registration keeps one element state and one queue entry', () => {
  withSchedulingDom({}, () => {
    const paragraph = makeSchedulingElement();
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.filter = { isEligible: () => true };
    silenceTranslationPipeline(manager);

    assert.equal(manager.registerElement(paragraph), true);
    assert.equal(manager.registerElement(paragraph), false);

    assert.deepEqual(manager.elements, [paragraph]);
    assert.deepEqual(manager.queue, [paragraph]);
    assert.equal(manager.elementStateMap.get(paragraph).state, 'queued');
  });
});

test('dynamic content registers the added element and descendants by viewport', () => {
  const mutation = createObserverDouble();
  withSchedulingDom({ MutationObserver: mutation.ObserverDouble }, () => {
    const addedVisible = makeSchedulingElement(20, 80);
    const wrapper = makeSchedulingElement(900, 960, 10, 210, { tagName: 'SECTION' });
    const descendantVisible = makeSchedulingElement(100, 160);
    const descendantOffscreen = makeSchedulingElement(900, 960);
    const observed = [];
    const manager = new PaperBilingualManager();
    manager.mode = 'chinese';
    manager.filter = {
      isExcluded: () => false,
      isEligible: (element) => element !== wrapper,
      findContentElements: (root) => root === wrapper
        ? [descendantVisible, descendantOffscreen, descendantVisible]
        : []
    };
    manager.observer = { observe: (element) => observed.push(element), disconnect() {} };
    silenceTranslationPipeline(manager);
    manager.observeContentChanges();

    mutation.instances[0].emit([{
      addedNodes: [addedVisible, wrapper, wrapper]
    }]);

    assert.deepEqual(manager.queue, [addedVisible, descendantVisible]);
    assert.deepEqual(manager.elements, [addedVisible, descendantVisible, descendantOffscreen]);
    assert(observed.includes(descendantOffscreen));
  });
});

test('text hydration registers an initially empty paragraph exactly once', () => {
  const mutation = createObserverDouble();
  withSchedulingDom({ MutationObserver: mutation.ObserverDouble }, ({ body }) => {
    const paragraph = makeSchedulingElement(20, 80, 10, 210, { text: '' });
    body.appendChild(paragraph);
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.processQueue = () => {};
    manager.renderLoadingPlaceholder = () => {};
    manager.applyDisplayModeToAll = () => {};
    manager.updateCapsuleStats = () => {};
    manager.observeContentChanges();

    mutation.instances[0].emit([{
      type: 'childList',
      target: body,
      addedNodes: [paragraph],
      removedNodes: []
    }]);
    assert.deepEqual(manager.queue, []);

    paragraph.innerText = 'Hydrated academic prose now contains enough English text for translation.';
    const textNode = { nodeType: 3, parentElement: paragraph, parentNode: paragraph };
    mutation.instances[0].emit([{
      type: 'childList',
      target: paragraph,
      addedNodes: [textNode],
      removedNodes: []
    }]);
    mutation.instances[0].emit([{ type: 'characterData', target: textNode }]);

    assert.deepEqual(manager.elements, [paragraph]);
    assert.deepEqual(manager.queue, [paragraph]);
    assert.equal(manager.elementStateMap.get(paragraph).state, 'queued');
    assert.equal(mutation.instances[0].observeCalls[0].options.characterData, true);
  });
});

test('adding a specific child replaces a queued aggregate paragraph', () => {
  const mutation = createObserverDouble();
  withSchedulingDom({ MutationObserver: mutation.ObserverDouble }, ({ body }) => {
    const text = 'This staged paragraph becomes a specific child without changing its academic text.';
    const aggregate = makeSchedulingElement(20, 80, 10, 210, {
      tagName: 'DIV',
      role: 'paragraph',
      text
    });
    body.appendChild(aggregate);
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.processQueue = () => {};
    manager.renderLoadingPlaceholder = (element, info) => {
      info.transEl = createTranslationNodeDouble();
    };
    manager.applyDisplayModeToAll = () => {};
    manager.updateCapsuleStats = () => {};
    manager.observeContentChanges();
    manager.registerElement(aggregate);
    const aggregateInfo = manager.elementStateMap.get(aggregate);
    const loadingNode = aggregateInfo.transEl;

    aggregate.innerText = '';
    const child = aggregate.appendChild(makeSchedulingElement(20, 80, 10, 210, { text }));
    mutation.instances[0].emit([{
      type: 'childList',
      target: aggregate,
      addedNodes: [child],
      removedNodes: []
    }]);

    assert.deepEqual(manager.elements, [child]);
    assert.deepEqual(manager.queue, [child]);
    assert.equal(manager.registeredElements.has(aggregate), false);
    assert.equal(manager.elementStateMap.has(aggregate), false);
    assert.equal(loadingNode.removed, true);
    assert.equal(aggregateInfo.requestId, null);
  });
});

test('in-flight aggregate replacement shares its request and renders only the child', () => {
  const mutation = createObserverDouble();
  return withSchedulingDom({ MutationObserver: mutation.ObserverDouble }, async ({ body }) => {
    const text = 'This staged paragraph is hydrated into a specific child while translation is pending.';
    const aggregate = makeSchedulingElement(20, 80, 10, 210, {
      tagName: 'DIV',
      role: 'paragraph',
      text
    });
    body.appendChild(aggregate);
    const deferred = createDeferred();
    const requests = [];
    const renders = [];
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.formulaProtector = {
      protect: (element) => ({
        protectedText: (element.innerText || element.textContent || '').trim(),
        tokenMap: new Map()
      }),
      restore: (translation) => translation,
      escapeHtml: (value) => value
    };
    manager.renderLoadingPlaceholder = (element, info) => {
      info.transEl = createTranslationNodeDouble();
    };
    manager.requestTranslation = (requestText) => {
      requests.push(requestText);
      return deferred.promise;
    };
    manager.renderTranslation = (element, info, translation) => {
      renders.push({ element, translation });
    };
    manager.applyDisplayModeToAll = () => {};
    manager.updateCapsuleStats = () => {};
    manager.observeContentChanges();
    manager.registerElement(aggregate);
    const aggregateInfo = manager.elementStateMap.get(aggregate);
    const aggregateLoading = aggregateInfo.transEl;
    assert.equal(aggregateInfo.state, 'translating');
    assert.deepEqual(requests, [text]);

    aggregate.innerText = '';
    const child = aggregate.appendChild(makeSchedulingElement(20, 80, 10, 210, { text }));
    mutation.instances[0].emit([{
      type: 'childList',
      target: aggregate,
      addedNodes: [child],
      removedNodes: []
    }]);

    assert.equal(manager.registeredElements.has(aggregate), false);
    assert.equal(aggregateLoading.removed, true);
    assert.deepEqual(requests, [text]);

    deferred.resolve({ success: true, translation: 'translated child' });
    await flushSchedulingPromises();

    assert.deepEqual(requests, [text]);
    assert.deepEqual(renders, [{ element: child, translation: 'translated child' }]);
    assert.equal(manager.elementStateMap.get(child).state, 'done');
    assert.deepEqual(manager.elements, [child]);
  });
});

test('saturated aggregate replacement retains the shared request until the child consumes it', () => {
  const mutation = createObserverDouble();
  return withSchedulingDom({ MutationObserver: mutation.ObserverDouble }, async ({ body }) => {
    const aggregateText = 'This saturated aggregate includes temporary wrapper text around the requested payload.';
    const childText = 'This specific child contains the stable academic payload requested from translation.';
    const sharedPayload = 'stable protected translation payload';
    const blockerText = 'This independent paragraph occupies the second translation request slot.';
    const aggregate = body.appendChild(makeSchedulingElement(20, 80, 10, 210, {
      tagName: 'DIV',
      role: 'paragraph',
      text: aggregateText
    }));
    const blocker = body.appendChild(makeSchedulingElement(100, 160, 10, 210, { text: blockerText }));
    const sharedRequest = createDeferred();
    const blockerRequest = createDeferred();
    const requests = [];
    const renders = [];
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.formulaProtector = {
      protect: (element) => ({
        protectedText: element === blocker ? blockerText : sharedPayload,
        tokenMap: new Map()
      }),
      restore: (translation) => translation,
      escapeHtml: (value) => value
    };
    manager.renderLoadingPlaceholder = (element, info) => {
      info.transEl = createTranslationNodeDouble();
    };
    manager.requestTranslation = (text) => {
      requests.push(text);
      return text === sharedPayload ? sharedRequest.promise : blockerRequest.promise;
    };
    manager.renderTranslation = (element, info, translation) => {
      renders.push({ element, translation });
    };
    manager.applyDisplayModeToAll = () => {};
    manager.updateCapsuleStats = () => {};
    manager.observeContentChanges();
    manager.registerElement(aggregate);
    manager.registerElement(blocker);
    assert.equal(manager.activeRequests, manager.maxConcurrency);
    assert.deepEqual(requests, [sharedPayload, blockerText]);

    aggregate.innerText = '';
    const child = aggregate.appendChild(makeSchedulingElement(20, 80, 10, 210, { text: childText }));
    mutation.instances[0].emit([{
      type: 'childList',
      target: aggregate,
      addedNodes: [child],
      removedNodes: []
    }]);
    assert.deepEqual(manager.queue, [child]);

    sharedRequest.resolve({ success: true, translation: 'shared translation' });
    await flushSchedulingPromises();

    assert.equal(requests.filter((text) => text === sharedPayload).length, 1);
    assert.deepEqual(
      renders.filter(({ element }) => element === child),
      [{ element: child, translation: 'shared translation' }]
    );
    assert.equal(manager.elementStateMap.get(child).state, 'done');

    blockerRequest.resolve({ success: true, translation: 'blocker translation' });
    await flushSchedulingPromises();
    assert.equal(manager.activeRequests, 0);
  });
});

test('original mode invalidates a deferred request and permits a clean re-entry', () => {
  return withSchedulingDom({}, async ({ body }) => {
    const paragraph = body.appendChild(makeSchedulingElement());
    const oldRequest = createDeferred();
    const newRequest = createDeferred();
    const deferreds = [oldRequest, newRequest];
    const requests = [];
    const renders = [];
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.filter = {
      findContentElements: () => [paragraph],
      isEligible: () => true
    };
    manager.formulaProtector = {
      protect: (element) => ({
        protectedText: (element.innerText || element.textContent || '').trim(),
        tokenMap: new Map()
      }),
      restore: (translation) => translation,
      escapeHtml: (value) => value
    };
    manager.renderLoadingPlaceholder = (element, info) => {
      info.transEl = createTranslationNodeDouble();
    };
    manager.requestTranslation = (text) => {
      requests.push(text);
      return deferreds[requests.length - 1].promise;
    };
    manager.renderTranslation = (element, info, translation) => {
      renders.push({ element, translation });
    };
    manager.applyDisplayModeToAll = () => {};
    manager.updateCapsuleStats = () => {};
    manager.registerElement(paragraph);
    const info = manager.elementStateMap.get(paragraph);
    const oldLoading = info.transEl;
    assert.equal(info.state, 'translating');

    manager.mode = 'original';
    manager.restoreOriginalView();
    assert.equal(info.state, 'idle');
    assert.equal(info.requestId, null);
    assert.equal(info.transEl, null);
    assert.equal(oldLoading.removed, true);

    oldRequest.resolve({ success: true, translation: 'stale original-mode response' });
    await flushSchedulingPromises();
    assert.deepEqual(renders, []);
    assert.equal(manager.cache.size, 0);
    assert.equal(manager.activeRequests, 0);

    manager.mode = 'bilingual';
    manager.activateBilingualView();
    assert.equal(requests.length, 2);
    assert.equal(info.state, 'translating');

    newRequest.resolve({ success: true, translation: 'fresh re-entry response' });
    await flushSchedulingPromises();
    assert.deepEqual(renders, [{ element: paragraph, translation: 'fresh re-entry response' }]);
    assert.equal(info.state, 'done');
    assert.equal(manager.cache.get(paragraph.innerText), 'fresh re-entry response');
  });
});

test('configuration generation rejects old responses and retries after the occupied slot releases', () => {
  return withSchedulingDom({}, async ({ body }) => {
    const previousChrome = global.chrome;
    let storageListener = null;
    global.chrome = {
      storage: {
        onChanged: { addListener(listener) { storageListener = listener; } }
      }
    };
    try {
      const paragraph = body.appendChild(makeSchedulingElement());
      const oldRequest = createDeferred();
      const newRequest = createDeferred();
      const deferreds = [oldRequest, newRequest];
      const requests = [];
      const renders = [];
      const manager = new PaperBilingualManager();
      manager.mode = 'bilingual';
      manager.maxConcurrency = 1;
      manager.formulaProtector = {
        protect: (element) => ({
          protectedText: (element.innerText || element.textContent || '').trim(),
          tokenMap: new Map()
        }),
        restore: (translation) => translation,
        escapeHtml: (value) => value
      };
      manager.renderLoadingPlaceholder = (element, info) => {
        info.transEl = createTranslationNodeDouble();
      };
      manager.requestTranslation = (text) => {
        requests.push(text);
        return deferreds[requests.length - 1].promise;
      };
      manager.renderTranslation = (element, info, translation) => {
        renders.push({ element, translation });
      };
      manager.updateCapsuleStats = () => {};
      manager.setupStorageListener();
      manager.registerElement(paragraph);
      const info = manager.elementStateMap.get(paragraph);
      assert.equal(requests.length, 1);
      assert.equal(manager.translationConfigGeneration, 0);

      storageListener({ customModel: { oldValue: 'old', newValue: 'new' } }, 'sync');
      assert.equal(manager.translationConfigGeneration, 1);
      assert.equal(info.state, 'queued');
      assert.equal(requests.length, 1);

      oldRequest.resolve({ success: true, translation: 'old configuration response' });
      await flushSchedulingPromises();
      assert.deepEqual(renders, []);
      assert.equal(manager.cache.size, 0);
      assert.equal(requests.length, 2);
      assert.equal(info.state, 'translating');

      newRequest.resolve({ success: true, translation: 'new configuration response' });
      await flushSchedulingPromises();
      assert.deepEqual(renders, [{ element: paragraph, translation: 'new configuration response' }]);
      assert.equal(manager.cache.get(paragraph.innerText), 'new configuration response');
      assert.equal(info.state, 'done');
      assert.equal(manager.activeRequests, 0);
    } finally {
      if (previousChrome === undefined) delete global.chrome;
      else global.chrome = previousChrome;
    }
  });
});

test('every translation-affecting storage key advances the configuration generation', () => {
  const cases = [
    ['sync', 'customEngine'],
    ['sync', 'customApiEndpoint'],
    ['sync', 'customModel'],
    ['sync', 'onlineFallback'],
    ['local', 'customApiKey'],
    ['local', 'glossaryVersion']
  ];
  const previousChrome = global.chrome;
  try {
    for (const [area, key] of cases) {
      let storageListener = null;
      global.chrome = {
        storage: {
          onChanged: { addListener(listener) { storageListener = listener; } }
        }
      };
      const manager = new PaperBilingualManager();
      manager.cache.set('paragraph', 'translation');
      manager.setupStorageListener();
      storageListener({ [key]: { oldValue: 'old', newValue: 'new' } }, area);
      assert.equal(manager.translationConfigGeneration, 1, `${area}:${key}`);
      assert.equal(manager.cache.size, 0, `${area}:${key}`);
    }
  } finally {
    if (previousChrome === undefined) delete global.chrome;
    else global.chrome = previousChrome;
  }
});

test('dynamic observation ignores generated nodes and excluded subtrees without rescanning them', () => {
  const mutation = createObserverDouble();
  withSchedulingDom({ MutationObserver: mutation.ObserverDouble }, ({ body }) => {
    const generated = [
      makeSchedulingElement(20, 80, 10, 210, { tagName: 'DIV', className: 'pd-bilingual-trans' }),
      makeSchedulingElement(20, 80, 10, 210, { tagName: 'DIV', className: 'pd-bilingual-loading' }),
      makeSchedulingElement(20, 80, 10, 210, { tagName: 'DIV', className: 'pd-bilingual-fail' }),
      makeSchedulingElement(20, 80, 10, 210, { tagName: 'DIV', className: 'pd-mode-toast' }),
      makeSchedulingElement(20, 80, 10, 210, { tagName: 'PAPERDICT-BILINGUAL-CAPSULE-HOST' })
    ];
    const excluded = createAcademicElement('NAV', '');
    excluded.nodeType = 1;
    for (const node of [...generated, excluded]) body.appendChild(node);

    const academicFilter = new AcademicFilter();
    const scanned = [];
    const registered = [];
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.filter = {
      isExcluded: academicFilter.isExcluded.bind(academicFilter),
      isEligible: () => false,
      findContentElements(node) {
        scanned.push(node);
        return [];
      }
    };
    manager.registerElement = (element) => registered.push(element);
    silenceTranslationPipeline(manager);
    manager.observeContentChanges();

    mutation.instances[0].emit([{ addedNodes: [...generated, excluded] }]);
    const generatedText = { nodeType: 3, parentElement: generated[0], parentNode: generated[0] };
    mutation.instances[0].emit([{ type: 'characterData', target: generatedText }]);
    mutation.instances[0].emit([{
      type: 'childList',
      target: body,
      addedNodes: [],
      removedNodes: [generated[1]]
    }]);

    assert.deepEqual(registered, []);
    assert.deepEqual(scanned, []);
  });
});

test('removing a queued paragraph drops all strong scheduling references before dispatch', () => {
  const mutation = createObserverDouble();
  return withSchedulingDom({ MutationObserver: mutation.ObserverDouble }, async ({ body }) => {
    const wrapper = body.appendChild(createAcademicElement('SECTION', ''));
    wrapper.nodeType = 1;
    const paragraph = wrapper.appendChild(makeSchedulingElement());
    const unobserved = [];
    const requests = [];
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.observer = {
      observe() {},
      unobserve: (element) => unobserved.push(element),
      disconnect() {}
    };
    manager.processQueue = () => {};
    manager.renderLoadingPlaceholder = (element, info) => {
      info.transEl = createTranslationNodeDouble();
    };
    manager.requestTranslation = (text) => {
      requests.push(text);
      return Promise.resolve({ success: true, translation: 'unused' });
    };
    manager.renderTranslation = () => {};
    manager.applyDisplayModeToAll = () => {};
    manager.updateCapsuleStats = () => {};
    manager.observeContentChanges();
    manager.registerElement(paragraph);
    const info = manager.elementStateMap.get(paragraph);
    const loadingNode = info.transEl;
    assert.deepEqual(manager.queue, [paragraph]);

    wrapper.isConnected = false;
    paragraph.isConnected = false;
    body.children = body.children.filter((child) => child !== wrapper);
    wrapper.parentElement = null;
    mutation.instances[0].emit([{
      type: 'childList',
      target: body,
      addedNodes: [],
      removedNodes: [wrapper]
    }]);

    await PaperBilingualManager.prototype.processQueue.call(manager);
    assert.deepEqual(requests, []);
    assert.deepEqual(manager.queue, []);
    assert.deepEqual(manager.elements, []);
    assert.equal(manager.registeredElements.has(paragraph), false);
    assert.equal(manager.elementStateMap.has(paragraph), false);
    assert.equal(info.requestId, null);
    assert.equal(loadingNode.removed, true);
    assert(unobserved.includes(paragraph));
  });
});

test('removing an in-flight paragraph prevents stale rendering and orphan nodes', () => {
  const mutation = createObserverDouble();
  return withSchedulingDom({ MutationObserver: mutation.ObserverDouble }, async ({ body }) => {
    const paragraph = body.appendChild(makeSchedulingElement());
    const deferred = createDeferred();
    const requests = [];
    const renders = [];
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.formulaProtector = {
      protect: (element) => ({
        protectedText: (element.innerText || element.textContent || '').trim(),
        tokenMap: new Map()
      }),
      restore: (translation) => translation,
      escapeHtml: (value) => value
    };
    manager.renderLoadingPlaceholder = (element, info) => {
      info.transEl = createTranslationNodeDouble();
    };
    manager.requestTranslation = (text) => {
      requests.push(text);
      return deferred.promise;
    };
    manager.renderTranslation = (element, info, translation) => {
      renders.push({ element, translation });
    };
    manager.applyDisplayModeToAll = () => {};
    manager.updateCapsuleStats = () => {};
    manager.observeContentChanges();
    manager.registerElement(paragraph);
    const info = manager.elementStateMap.get(paragraph);
    const loadingNode = info.transEl;
    assert.equal(info.state, 'translating');
    assert.equal(requests.length, 1);

    paragraph.isConnected = false;
    body.children = body.children.filter((child) => child !== paragraph);
    paragraph.parentElement = null;
    mutation.instances[0].emit([{
      type: 'childList',
      target: body,
      addedNodes: [],
      removedNodes: [paragraph]
    }]);

    assert.equal(manager.registeredElements.has(paragraph), false);
    assert.equal(manager.elementStateMap.has(paragraph), false);
    assert.equal(loadingNode.removed, true);
    assert.equal(info.requestId, null);

    deferred.resolve({ success: true, translation: 'stale translation' });
    await flushSchedulingPromises();

    assert.equal(requests.length, 1);
    assert.deepEqual(renders, []);
    assert.deepEqual(manager.elements, []);
    assert.equal(manager.activeRequests, 0);
  });
});

test('restoring and re-entering page mode reconnects observers and resets queued work', () => {
  const mutation = createObserverDouble();
  withSchedulingDom({ MutationObserver: mutation.ObserverDouble }, () => {
    const paragraph = makeSchedulingElement();
    const intersectionObserver = {
      disconnectCalls: 0,
      observed: [],
      disconnect() { this.disconnectCalls++; },
      observe(element) { this.observed.push(element); }
    };
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.filter = {
      findContentElements: () => [paragraph],
      isEligible: () => true
    };
    manager.observer = intersectionObserver;
    silenceTranslationPipeline(manager);

    manager.activateBilingualView();
    assert.equal(manager.elementStateMap.get(paragraph).state, 'queued');
    manager.mode = 'original';
    manager.restoreOriginalView();
    assert.equal(manager.queue.length, 0);
    assert.equal(manager.elementStateMap.get(paragraph).state, 'idle');

    manager.mode = 'bilingual';
    manager.activateBilingualView();
    assert.deepEqual(manager.queue, [paragraph]);
    assert.equal(intersectionObserver.disconnectCalls, 3);
    assert.equal(mutation.instances[0].disconnectCalls, 3);
    assert.equal(mutation.instances[0].observeCalls.length, 2);

    manager.mode = 'original';
    mutation.instances[0].emit([{ addedNodes: [makeSchedulingElement()] }]);
    assert.deepEqual(manager.queue, [paragraph]);
  });
});

test('restore resets queued state even when a rescan no longer discovers the element', () => {
  withSchedulingDom({}, () => {
    const paragraph = makeSchedulingElement();
    let discovered = [paragraph];
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.filter = {
      findContentElements: () => discovered,
      isEligible: () => true
    };
    silenceTranslationPipeline(manager);

    manager.activateBilingualView();
    assert.equal(manager.elementStateMap.get(paragraph).state, 'queued');
    discovered = [];
    manager.activateBilingualView();
    assert.deepEqual(manager.elements, []);

    manager.mode = 'original';
    manager.restoreOriginalView();

    assert.deepEqual(manager.queue, []);
    assert.equal(manager.elementStateMap.get(paragraph).state, 'idle');
  });
});

test('missing observer APIs still enqueue every initially discovered paragraph', () => {
  withSchedulingDom({}, () => {
    const visible = makeSchedulingElement(20, 80);
    const offscreen = makeSchedulingElement(900, 960);
    const manager = new PaperBilingualManager();
    manager.mode = 'bilingual';
    manager.filter = {
      findContentElements: () => [visible, offscreen],
      isEligible: () => true
    };
    silenceTranslationPipeline(manager);

    manager.setupObserver();
    manager.activateBilingualView();

    assert.equal(manager.observer, null);
    assert.equal(manager.mutationObserver, null);
    assert.deepEqual(manager.queue, [visible, offscreen]);
  });
});

const contentJs = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8')
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
);
const { CONTENT_SCRIPT_FILES } = require('../extension/popup/tab_bridge.js');
const readerHtml = fs.readFileSync(path.join(__dirname, '../extension/reader/reader.html'), 'utf8');

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      listeners.set(type, registered.filter((item) => item !== listener));
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function createClassList(element) {
  const values = new Set();
  const sync = () => { element._className = [...values].join(' '); };
  return {
    add(...names) { names.forEach((name) => values.add(name)); sync(); },
    remove(...names) { names.forEach((name) => values.delete(name)); sync(); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name);
      else values.delete(name);
      sync();
      return enabled;
    },
    reset(className) {
      values.clear();
      String(className || '').split(/\s+/).filter(Boolean).forEach((name) => values.add(name));
      sync();
    }
  };
}

function createElement(tagName) {
  const element = Object.assign(createEventTarget(), {
    tagName: String(tagName).toUpperCase(),
    id: '',
    style: {},
    children: [],
    parentElement: null,
    innerHTML: '',
    textContent: '',
    title: '',
    offsetHeight: 180,
    offsetWidth: 320,
    onclick: null,
    appendChild(child) {
      child.parentElement = element;
      element.children.push(child);
      return child;
    },
    attachShadow() {
      const nodesById = new Map();
      const root = Object.assign(createEventTarget(), {
        children: [],
        appendChild(child) {
          child.parentElement = element;
          root.children.push(child);
          if (child.id) nodesById.set(child.id, child);
          return child;
        },
        querySelector(selector) {
          if (!selector.startsWith('#')) return null;
          const id = selector.slice(1);
          if (!nodesById.has(id)) {
            const node = createElement('button');
            node.id = id;
            nodesById.set(id, node);
          }
          return nodesById.get(id);
        }
      });
      element.shadowRoot = root;
      return root;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
    },
    closest() { return null; }
  });
  element.classList = createClassList(element);
  Object.defineProperty(element, 'className', {
    get() { return element._className || ''; },
    set(value) { element.classList.reset(value); }
  });
  return element;
}

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createContentHarness() {
  const document = Object.assign(createEventTarget(), {
    body: createElement('body'),
    documentElement: createElement('html'),
    activeElement: null,
    createElement
  });
  document.activeElement = document.body;

  let selection = { rangeCount: 0, isCollapsed: true, toString: () => '' };
  let liveRect = null;
  let selectedNode = null;
  let detachCalls = 0;
  let nextTimerId = 1;
  let timers = [];
  let animationFrames = [];
  const requests = [];
  const runtimeMessages = createEventTarget();

  const window = Object.assign(createEventTarget(), {
    innerWidth: 800,
    innerHeight: 600,
    location: { hostname: 'example.com' },
    getSelection: () => selection,
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    }
  });

  class DictServiceMock {
    cleanPaperText(text) { return String(text || '').trim(); }
    isLookupEligible(text) { return Boolean(text); }
    isSingleWord(text) { return !String(text).includes(' '); }
    lookupLocal() { return { found: false }; }
    parseDefinitions() { return []; }
  }
  window.DictService = DictServiceMock;

  const chrome = {
    storage: {
      sync: { get(defaults, callback) { callback(defaults); } },
      local: {
        get(defaults, callback) { callback(defaults); },
        set() {}
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      sendMessage(message) {
        const deferred = createDeferred();
        requests.push({ message, ...deferred });
        return deferred.promise;
      },
      onMessage: { addListener: runtimeMessages.addEventListener.bind(runtimeMessages, 'message') }
    }
  };

  const context = {
    window,
    document,
    chrome,
    DictService: DictServiceMock,
    PaperDictSelectionAnchor: selectionAnchorHelpers,
    ACADEMIC_DICT: null,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    Audio: function Audio() {},
    console,
    setTimeout(callback) {
      const id = nextTimerId++;
      timers.push({ id, callback });
      return id;
    },
    clearTimeout(id) {
      timers = timers.filter((timer) => timer.id !== id);
    }
  };
  vm.runInNewContext(contentJs, context, { filename: 'extension/content.js' });

  return {
    document,
    window,
    requests,
    setDomSelection(text, rect) {
      liveRect = rect;
      selectedNode = { isConnected: true };
      const clonedRange = {
        startContainer: selectedNode,
        endContainer: selectedNode,
        commonAncestorContainer: selectedNode,
        startOffset: 0,
        endOffset: text.length,
        getBoundingClientRect: () => liveRect,
        detach() { detachCalls++; }
      };
      const range = {
        startContainer: selectedNode,
        endContainer: selectedNode,
        commonAncestorContainer: selectedNode,
        startOffset: 0,
        endOffset: text.length,
        cloneRange: () => clonedRange,
        getBoundingClientRect: () => liveRect
      };
      selection = {
        rangeCount: 1,
        isCollapsed: false,
        toString: () => text,
        getRangeAt: () => range
      };
    },
    setCollapsedSelection() {
      selection = { rangeCount: 0, isCollapsed: true, toString: () => '' };
    },
    setCardSelection() {
      const host = document.body.children.find((node) => node.id === 'paper-dict-host-root');
      const root = host.shadowRoot;
      const cardNode = { isConnected: true, getRootNode: () => root };
      const range = {
        startContainer: cardNode,
        endContainer: cardNode,
        startOffset: 0,
        endOffset: 4
      };
      selection = {
        rangeCount: 1,
        isCollapsed: false,
        anchorNode: cardNode,
        focusNode: cardNode,
        getRangeAt: () => range,
        toString: () => 'text'
      };
    },
    disconnectSelection() {
      if (selectedNode) selectedNode.isConnected = false;
    },
    setRect(rect) { liveRect = rect; },
    flushTimers() {
      const pending = timers;
      timers = [];
      pending.forEach((timer) => timer.callback());
    },
    flushAnimationFrames() {
      const pending = animationFrames;
      animationFrames = [];
      pending.forEach((callback) => callback());
    },
    getAnimationFrameCount: () => animationFrames.length,
    getDetachCalls: () => detachCalls,
    getCard() {
      const host = document.body.children.find((node) => node.id === 'paper-dict-host-root');
      return host && host.shadowRoot.children.find((node) => node.classList.contains('paper-dict-card'));
    },
    getShadowRoot() {
      const host = document.body.children.find((node) => node.id === 'paper-dict-host-root');
      return host && host.shadowRoot;
    },
    dispatchRuntimeMessage(message) { runtimeMessages.dispatch('message', message); }
  };
}

async function resolveRequest(harness, index, response) {
  harness.requests[index].resolve(response);
  await Promise.resolve();
  await Promise.resolve();
}

async function showSelectionCard(harness, rect, text = 'alpha') {
  const requestIndex = harness.requests.length;
  harness.setDomSelection(text, rect);
  harness.document.dispatch('mouseup', { composedPath: () => [] });
  harness.flushTimers();
  assert.equal(harness.requests.length, requestIndex + 1);
  await resolveRequest(harness, requestIndex, {
    success: true,
    found: true,
    translation: 'translated',
    source: 'test glossary'
  });
  return harness.getCard();
}

test('every content loader places selection_anchor.js immediately before content.js', () => {
  const scripts = manifest.content_scripts[0].js;
  const contentIndex = scripts.indexOf('content.js');
  assert(contentIndex > 0);
  assert.equal(scripts[contentIndex - 1], 'selection_anchor.js');

  const recoveryContentIndex = CONTENT_SCRIPT_FILES.indexOf('content.js');
  assert(recoveryContentIndex > 0);
  assert.equal(CONTENT_SCRIPT_FILES[recoveryContentIndex - 1], 'selection_anchor.js');

  const readerScripts = [...readerHtml.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  const readerContentIndex = readerScripts.indexOf('../content.js');
  assert(readerContentIndex > 0);
  assert.equal(readerScripts[readerContentIndex - 1], '../selection_anchor.js');
});

test('content listeners safely ignore a keyup event without key', () => {
  const harness = createContentHarness();
  assert.doesNotThrow(() => harness.document.dispatch('keyup', {}));
});

test('content card uses delayed live geometry and follows throttled scroll and resize', async () => {
  const harness = createContentHarness();
  harness.setDomSelection('alpha', {
    left: 40, top: 100, right: 140, bottom: 120, width: 100, height: 20
  });
  harness.document.dispatch('mouseup', { composedPath: () => [] });
  harness.flushTimers();
  assert.equal(harness.getCard(), undefined);

  harness.setRect({ left: 250, top: 200, right: 350, bottom: 220, width: 100, height: 20 });
  await resolveRequest(harness, 0, {
    success: true,
    found: true,
    translation: 'translated',
    source: 'test glossary'
  });
  const card = harness.getCard();
  assert(card.classList.contains('visible'));
  assert.equal(card.style.top, '228px');

  harness.setRect({ left: 300, top: 240, right: 400, bottom: 260, width: 100, height: 20 });
  harness.window.dispatch('scroll');
  harness.window.dispatch('scroll');
  assert.equal(harness.getAnimationFrameCount(), 1);
  harness.flushAnimationFrames();
  assert.equal(card.style.top, '268px');

  harness.setRect({ left: 350, top: 280, right: 450, bottom: 300, width: 100, height: 20 });
  harness.window.dispatch('resize');
  harness.flushAnimationFrames();
  assert.equal(card.style.top, '308px');

  harness.getShadowRoot().querySelector('#btn-pin').onclick({ stopPropagation() {} });
  harness.setRect({ left: 350, top: -40, right: 450, bottom: -20, width: 100, height: 20 });
  harness.window.dispatch('scroll');
  harness.flushAnimationFrames();
  assert.equal(card.classList.contains('visible'), false);
  assert.equal(harness.getDetachCalls(), 1);
});

test('input and context-menu lookups dispose an existing DOM range anchor', async () => {
  const harness = createContentHarness();
  await showSelectionCard(harness, {
    left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20
  });

  const input = createElement('input');
  input.value = 'input';
  input.selectionStart = 0;
  input.selectionEnd = 5;
  input.getBoundingClientRect = () => ({
    left: 100, top: 140, right: 200, bottom: 160, width: 100, height: 20
  });
  harness.document.activeElement = input;
  harness.document.dispatch('mouseup', { composedPath: () => [] });
  harness.flushTimers();
  assert.equal(harness.getDetachCalls(), 1);

  harness.document.activeElement = harness.document.body;
  await showSelectionCard(harness, {
    left: 100, top: 180, right: 200, bottom: 200, width: 100, height: 20
  }, 'beta');
  harness.dispatchRuntimeMessage({ type: 'TRIGGER_TRANSLATE_FROM_MENU', text: 'context' });
  assert.equal(harness.getDetachCalls(), 2);
});

test('close and outside dismiss dispose the live range anchor', async () => {
  const closeHarness = createContentHarness();
  const closeCard = await showSelectionCard(closeHarness, {
    left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20
  });
  closeHarness.getShadowRoot().querySelector('#btn-close').onclick({ stopPropagation() {} });
  assert.equal(closeCard.classList.contains('visible'), false);
  assert.equal(closeHarness.getDetachCalls(), 1);

  const dismissHarness = createContentHarness();
  const dismissCard = await showSelectionCard(dismissHarness, {
    left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20
  });
  dismissHarness.setCollapsedSelection();
  dismissHarness.document.dispatch('mousedown', { composedPath: () => [] });
  assert.equal(dismissCard.classList.contains('visible'), false);
  assert.equal(dismissHarness.getDetachCalls(), 1);
});

test('selectionchange force-hides pinned cards for collapsed, mismatched, or disconnected selections', async () => {
  const collapsedHarness = createContentHarness();
  const collapsedCard = await showSelectionCard(collapsedHarness, {
    left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20
  });
  collapsedHarness.getShadowRoot().querySelector('#btn-pin').onclick({ stopPropagation() {} });
  collapsedHarness.setCollapsedSelection();
  collapsedHarness.document.dispatch('selectionchange');
  assert.equal(collapsedCard.classList.contains('visible'), false);
  assert.equal(collapsedHarness.getDetachCalls(), 1);

  const mismatchHarness = createContentHarness();
  const mismatchCard = await showSelectionCard(mismatchHarness, {
    left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20
  });
  mismatchHarness.setDomSelection('different', {
    left: 220, top: 100, right: 320, bottom: 120, width: 100, height: 20
  });
  mismatchHarness.document.dispatch('selectionchange');
  assert.equal(mismatchCard.classList.contains('visible'), false);
  assert.equal(mismatchHarness.getDetachCalls(), 1);

  const disconnectedHarness = createContentHarness();
  const disconnectedCard = await showSelectionCard(disconnectedHarness, {
    left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20
  });
  disconnectedHarness.disconnectSelection();
  disconnectedHarness.document.dispatch('selectionchange');
  assert.equal(disconnectedCard.classList.contains('visible'), false);
  assert.equal(disconnectedHarness.getDetachCalls(), 1);
});

test('closed and replaced lookups stop before online translation while the current request completes', async () => {
  const closedHarness = createContentHarness();
  closedHarness.setDomSelection('closed', {
    left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20
  });
  closedHarness.document.dispatch('mouseup', { composedPath: () => [] });
  closedHarness.flushTimers();
  closedHarness.document.dispatch('keydown', { key: 'Escape' });
  await resolveRequest(closedHarness, 0, { success: true, found: false });
  assert.deepEqual(closedHarness.requests.map((request) => request.message.type), ['LOOKUP_GLOSSARY']);

  const replacedHarness = createContentHarness();
  replacedHarness.dispatchRuntimeMessage({ type: 'TRIGGER_TRANSLATE_FROM_MENU', text: 'old context' });
  replacedHarness.dispatchRuntimeMessage({ type: 'TRIGGER_TRANSLATE_FROM_MENU', text: 'current context' });
  await resolveRequest(replacedHarness, 0, { success: true, found: false });
  assert.deepEqual(
    replacedHarness.requests.map((request) => request.message.type),
    ['LOOKUP_GLOSSARY', 'LOOKUP_GLOSSARY']
  );

  await resolveRequest(replacedHarness, 1, { success: true, found: false });
  assert.equal(replacedHarness.requests[2].message.type, 'TRANSLATE_ONLINE');
  await resolveRequest(replacedHarness, 2, {
    success: true,
    translation: 'current translation',
    source: 'test online'
  });
  const card = replacedHarness.getCard();
  assert(card.classList.contains('visible'));
  assert.match(card.innerHTML, /current context/);
  assert.match(card.innerHTML, /current translation/);
});

test('selecting card text preserves the anchor request while external collapse still closes it', async () => {
  const harness = createContentHarness();
  harness.setDomSelection('anchored phrase', {
    left: 100, top: 100, right: 220, bottom: 120, width: 120, height: 20
  });
  harness.document.dispatch('mouseup', { composedPath: () => [] });
  harness.flushTimers();
  await resolveRequest(harness, 0, { success: true, found: false });

  const card = harness.getCard();
  assert(card.classList.contains('visible'));
  assert.equal(harness.requests[1].message.type, 'TRANSLATE_ONLINE');

  harness.setCardSelection();
  harness.document.dispatch('selectionchange');
  assert(card.classList.contains('visible'));
  assert.equal(harness.getDetachCalls(), 0);

  await resolveRequest(harness, 1, {
    success: true,
    translation: 'completed after card selection',
    source: 'test online'
  });
  assert.match(card.innerHTML, /completed after card selection/);

  harness.document.dispatch('mousedown', { composedPath: () => [card] });
  harness.setCollapsedSelection();
  harness.document.dispatch('selectionchange');
  assert(card.classList.contains('visible'));
  harness.document.dispatch('mouseup', { composedPath: () => [card] });
  harness.flushTimers();
  assert(card.classList.contains('visible'));

  harness.getShadowRoot().querySelector('#btn-pin').onclick({ stopPropagation() {} });
  harness.setCollapsedSelection();
  harness.document.dispatch('selectionchange');
  assert.equal(card.classList.contains('visible'), false);
  assert.equal(harness.getDetachCalls(), 1);
});

test('content script owns and clears one active DOM selection anchor', () => {
  assert.match(contentJs, /let activeSelectionAnchor = null/);
  assert.match(contentJs, /function clearActiveSelectionAnchor\(\)/);
  assert.match(contentJs, /activeSelectionAnchor\.dispose\(\)/);
  assert.match(contentJs, /activeSelectionAnchor = createRangeAnchor\(range\)/);
  assert.match(contentJs, /activeEl\.tagName === 'INPUT'[\s\S]{0,500}?clearActiveSelectionAnchor\(\)/);
  assert.match(contentJs, /overrideText[\s\S]*clearActiveSelectionAnchor\(\)/);
});

test('content script positions from the live anchor before showing the card', () => {
  assert.match(contentJs, /function getSelectionCardRect\(fallbackRect(?:, expectedAnchor = null)?\)/);
  assert.match(contentJs, /if \(expectedAnchor !== activeSelectionAnchor\) return/);
  assert.match(contentJs, /activeSelectionAnchor\.getRect\(window\.innerWidth, window\.innerHeight\)/);
  assert.match(contentJs, /const cardRect = getSelectionCardRect\(rect, expectedAnchor\);[\s\S]*?positionCard\(cardRect\)/);
});

test('content script throttles visible card positioning on scroll and resize', () => {
  assert.match(contentJs, /function scheduleSelectionCardPosition\(\)/);
  assert.match(contentJs, /requestAnimationFrame/);
  assert.match(contentJs, /window\.addEventListener\('scroll', scheduleSelectionCardPosition, \{ capture: true, passive: true \}\)/);
  assert.match(contentJs, /window\.addEventListener\('resize', scheduleSelectionCardPosition, \{ passive: true \}\)/);
  assert.match(contentJs, /clearActiveSelectionAnchor\(\);[\s\S]{0,100}?hideCard\(true\)/);
});

test('content script delegates key filtering to the safe helper', () => {
  assert.match(contentJs, /isSelectionNavigationKey\(e\)/);
  assert.doesNotMatch(contentJs, /e\.key\.startsWith\('Arrow'\)/);
});

test('npm test runs the paragraph experience suite first', () => {
  assert.match(packageJson.scripts.test, /^node tests\/test_paragraph_translation_experience\.js && /);
});

async function run() {
  console.log('=== PaperDict Paragraph Translation Experience Tests ===');
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`  PASS ${name}`);
    } catch (error) {
      failed++;
      console.error(`  FAIL ${name}`);
      console.error(`       ${error.stack || error.message}`);
    }
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
