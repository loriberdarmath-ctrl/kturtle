// Flower — a KTurtle classic. Draws a flower by repeating an arc pattern.
export const flower = `# Flower — a garden of petals

reset
canvassize 400, 400
center
penwidth 2
pencolor 200, 90, 120

repeat 36 {
  repeat 72 {
    forward 2
    turnright 5
  }
  turnright 10
}
`;
