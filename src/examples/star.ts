// Star — a five-pointed star. Demonstrates the angle-chasing trick (144°).
export const star = `# Star — a five-pointed star using turn angle 144°

reset
center
penwidth 3
pencolor 200, 90, 42

repeat 5 {
  forward 120
  turnright 144
}
`;
