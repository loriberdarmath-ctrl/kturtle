// Tree — recursion demo using `learn`. Draws a fractal tree.
export const tree = `# Tree — a recursive fractal tree

reset
canvassize 500, 500
go 250, 480
direction 0
penwidth 2
pencolor 95, 122, 90

learn branch $length {
  if $length < 6 {
    return 0
  }
  forward $length
  turnleft 25
  branch $length * 0.72
  turnright 50
  branch $length * 0.72
  turnleft 25
  backward $length
  return 0
}

branch 100
`;
