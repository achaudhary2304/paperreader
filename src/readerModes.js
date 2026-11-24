import { Sparkles, Lightbulb, Sigma, LibraryBig, Search } from 'lucide-react';

// Available reading actions; editable starting questions live in defaultPrompts.js.
export const MODES = {
  explain: {
    label: 'Explain passage',
    short: 'Explain',
    icon: Sparkles,
    color: 'purple',
    hint: 'A clear explanation grounded in the paper',
  },
  concept: {
    label: 'Explore concept',
    short: 'Concept',
    icon: Lightbulb,
    color: 'orange',
    hint: 'Definitions and missing prerequisites',
  },
  math: {
    label: 'Unpack the math',
    short: 'Math',
    icon: Sigma,
    color: 'blue',
    hint: 'Symbols, steps, and derivations',
  },
  literature: {
    label: 'Find related work',
    short: 'Literature',
    icon: LibraryBig,
    color: 'green',
    hint: 'Foundational and related papers',
  },
  search: {
    label: 'Side search',
    short: 'Search',
    icon: Search,
    color: 'pink',
    hint: 'Research a tangent without leaving the paper',
  },
};
