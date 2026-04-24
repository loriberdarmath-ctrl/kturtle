// Spiral — grows outward while changing color.
export const spiral = `# Spiral — draws a rainbow spiral from the center

reset
canvassize 400, 400
center
penwidth 1

$r = 255
$g = 50
$b = 50

for $i = 1 to 120 {
  pencolor $r, $g, $b
  forward $i * 2
  turnright 30
  $r = $r - 2
  $g = $g + 2
}
`;
