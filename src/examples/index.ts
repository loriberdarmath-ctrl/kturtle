// Examples Index
// Central export point for all TurtleScript examples

import { square } from './square';
import { star } from './star';
import { spiral } from './spiral';
import { flower } from './flower';
import { tree } from './tree';
import { armath3d } from './armath3d';

// Export all examples as a record for the dropdown. Order matters — these
// appear in the Open dialog list in declaration order, so we lead with the
// simplest programs (good for teaching) and end with the more elaborate
// demos.
export const examples: Record<string, string> = {
    'armath-3d.turtle': armath3d,
    'square.turtle': square,
    'star.turtle': star,
    'spiral.turtle': spiral,
    'flower.turtle': flower,
    'tree.turtle': tree,
};

// Default example to show on load.
export const defaultExample = 'armath-3d.turtle';

// Export individual examples for direct import if needed
export { square } from './square';
export { star } from './star';
export { spiral } from './spiral';
export { flower } from './flower';
export { tree } from './tree';
export { armath3d } from './armath3d';
