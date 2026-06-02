// Armath 3D — animated wireframe pyramid demo.
export const armath3d = `reset
canvassize 830, 630
canvascolor 10, 0, 0
clear
spritehide
penwidth 3

$step = 0.2
$animateLetters = 1

learn drawLine $x1, $y1, $x2, $y2 {
    $dx = $x2 - $x1
    $dy = $y2 - $y1
    $dist = sqrt (($dx * $dx) + ($dy * $dy))

    if $dist > 0 {
        $vy = 0 - $dy

        if $vy == 0 {
            if $dx >= 0 {
                $dir = 90
            }

            if $dx < 0 {
                $dir = 270
            }
        }

        if $vy != 0 {
            $dir = arctan ($dx / $vy)

            if $vy < 0 {
                $dir = $dir + 180
            }

            if $dir < 0 {
                $dir = $dir + 360
            }
        }

        penup
        go $x1, $y1
        direction $dir
        pendown
        forward $dist
        penup
    }
}

learn edge $x1, $y1, $z1, $x2, $y2, $z2, $rx, $ry, $rz, $mode {
    $cx = cos $rx
    $sx = sin $rx
    $cy = cos $ry
    $sy = sin $ry
    $cz = cos $rz
    $sz = sin $rz

    $ay = $y1 * $cx - $z1 * $sx
    $az = $y1 * $sx + $z1 * $cx
    $ax = $x1

    $bx = $ax * $cy + $az * $sy
    $bz = 0 - $ax * $sy + $az * $cy
    $by = $ay

    $px1 = $bx * $cz - $by * $sz
    $py1 = $bx * $sz + $by * $cz
    $pz1 = $bz

    $ay = $y2 * $cx - $z2 * $sx
    $az = $y2 * $sx + $z2 * $cx
    $ax = $x2

    $bx = $ax * $cy + $az * $sy
    $bz = 0 - $ax * $sy + $az * $cy
    $by = $ay

    $px2 = $bx * $cz - $by * $sz
    $py2 = $bx * $sz + $by * $cz
    $pz2 = $bz

    $pers1 = 450 / (450 + $pz1)
    $pers2 = 450 / (450 + $pz2)

    $sx1 = 415 + ($px1 * 4 * $pers1)
    $sy1 = 315 + ($py1 * 4 * $pers1)

    $sx2 = 415 + ($px2 * 4 * $pers2)
    $sy2 = 315 + ($py2 * 4 * $pers2)

    if $mode == 1 {
        pencolor 10, 0, 0
    }

    if $mode == 0 {
        $col = ($pz1 + $pz2 + 360) / 2

        if $col < 110 {
            $col = 110
        }

        if $col > 255 {
            $col = 255
        }

        pencolor $col, $col, $col
    }

    drawLine $sx1, $sy1, $sx2, $sy2
}

learn drawEdgeNow $x1, $y1, $z1, $x2, $y2, $z2, $rx, $ry, $rz {
    penwidth 3
    edge $x1, $y1, $z1, $x2, $y2, $z2, $rx, $ry, $rz, 0
}

learn eraseEdgeNow $x1, $y1, $z1, $x2, $y2, $z2, $rx, $ry, $rz {
    penwidth 6
    edge $x1, $y1, $z1, $x2, $y2, $z2, $rx, $ry, $rz, 1
}

learn swapEdge $x1, $y1, $z1, $x2, $y2, $z2, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz {
    drawEdgeNow $x1, $y1, $z1, $x2, $y2, $z2, $newrx, $newry, $newrz
    eraseEdgeNow $x1, $y1, $z1, $x2, $y2, $z2, $oldrx, $oldry, $oldrz
    drawEdgeNow $x1, $y1, $z1, $x2, $y2, $z2, $newrx, $newry, $newrz
}

learn drawObject $rx, $ry, $rz, $letters {
    $s = 70
    $b = 52
    $top = 0 - 75

    drawEdgeNow 0 - $s, $b, 0 - $s, $s, $b, 0 - $s, $rx, $ry, $rz
    drawEdgeNow $s, $b, 0 - $s, $s, $b, $s, $rx, $ry, $rz
    drawEdgeNow $s, $b, $s, 0 - $s, $b, $s, $rx, $ry, $rz
    drawEdgeNow 0 - $s, $b, $s, 0 - $s, $b, 0 - $s, $rx, $ry, $rz

    drawEdgeNow 0 - $s, $b, 0 - $s, 0, $top, 0, $rx, $ry, $rz
    drawEdgeNow $s, $b, 0 - $s, 0, $top, 0, $rx, $ry, $rz
    drawEdgeNow $s, $b, $s, 0, $top, 0, $rx, $ry, $rz
    drawEdgeNow 0 - $s, $b, $s, 0, $top, 0, $rx, $ry, $rz

    if $letters == 1 {
        drawEdgeNow 0 - 58, 0 - 4, 0, 0 - 53, 0 - 16, 0, $rx, $ry, $rz
        drawEdgeNow 0 - 48, 0 - 4, 0, 0 - 53, 0 - 16, 0, $rx, $ry, $rz
        drawEdgeNow 0 - 56, 0 - 10, 0, 0 - 50, 0 - 10, 0, $rx, $ry, $rz

        drawEdgeNow 0 - 41, 0 - 16, 0, 0 - 41, 0 - 4, 0, $rx, $ry, $rz
        drawEdgeNow 0 - 41, 0 - 16, 0, 0 - 32, 0 - 16, 0, $rx, $ry, $rz
        drawEdgeNow 0 - 32, 0 - 16, 0, 0 - 32, 0 - 10, 0, $rx, $ry, $rz
        drawEdgeNow 0 - 32, 0 - 10, 0, 0 - 41, 0 - 10, 0, $rx, $ry, $rz
        drawEdgeNow 0 - 41, 0 - 10, 0, 0 - 32, 0 - 4, 0, $rx, $ry, $rz

        drawEdgeNow 0 - 24, 0 - 4, 0, 0 - 24, 0 - 16, 0, $rx, $ry, $rz
        drawEdgeNow 0 - 24, 0 - 16, 0, 0 - 19, 0 - 9, 0, $rx, $ry, $rz
        drawEdgeNow 0 - 19, 0 - 9, 0, 0 - 14, 0 - 16, 0, $rx, $ry, $rz
        drawEdgeNow 0 - 14, 0 - 16, 0, 0 - 14, 0 - 4, 0, $rx, $ry, $rz

        drawEdgeNow 0 - 7, 0 - 4, 0, 0 - 2, 0 - 16, 0, $rx, $ry, $rz
        drawEdgeNow 3, 0 - 4, 0, 0 - 2, 0 - 16, 0, $rx, $ry, $rz
        drawEdgeNow 0 - 5, 0 - 10, 0, 1, 0 - 10, 0, $rx, $ry, $rz

        drawEdgeNow 10, 0 - 16, 0, 20, 0 - 16, 0, $rx, $ry, $rz
        drawEdgeNow 15, 0 - 16, 0, 15, 0 - 4, 0, $rx, $ry, $rz

        drawEdgeNow 27, 0 - 16, 0, 27, 0 - 4, 0, $rx, $ry, $rz
        drawEdgeNow 37, 0 - 16, 0, 37, 0 - 4, 0, $rx, $ry, $rz
        drawEdgeNow 27, 0 - 10, 0, 37, 0 - 10, 0, $rx, $ry, $rz
    }
}

learn swapObject $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz, $letters {
    $s = 70
    $b = 52
    $top = 0 - 75

    swapEdge 0 - $s, $b, 0 - $s, $s, $b, 0 - $s, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
    swapEdge $s, $b, 0 - $s, $s, $b, $s, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
    swapEdge $s, $b, $s, 0 - $s, $b, $s, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
    swapEdge 0 - $s, $b, $s, 0 - $s, $b, 0 - $s, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz

    swapEdge 0 - $s, $b, 0 - $s, 0, $top, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
    swapEdge $s, $b, 0 - $s, 0, $top, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
    swapEdge $s, $b, $s, 0, $top, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
    swapEdge 0 - $s, $b, $s, 0, $top, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz

    if $letters == 1 {
        swapEdge 0 - 58, 0 - 4, 0, 0 - 53, 0 - 16, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 0 - 48, 0 - 4, 0, 0 - 53, 0 - 16, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 0 - 56, 0 - 10, 0, 0 - 50, 0 - 10, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz

        swapEdge 0 - 41, 0 - 16, 0, 0 - 41, 0 - 4, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 0 - 41, 0 - 16, 0, 0 - 32, 0 - 16, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 0 - 32, 0 - 16, 0, 0 - 32, 0 - 10, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 0 - 32, 0 - 10, 0, 0 - 41, 0 - 10, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 0 - 41, 0 - 10, 0, 0 - 32, 0 - 4, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz

        swapEdge 0 - 24, 0 - 4, 0, 0 - 24, 0 - 16, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 0 - 24, 0 - 16, 0, 0 - 19, 0 - 9, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 0 - 19, 0 - 9, 0, 0 - 14, 0 - 16, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 0 - 14, 0 - 16, 0, 0 - 14, 0 - 4, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz

        swapEdge 0 - 7, 0 - 4, 0, 0 - 2, 0 - 16, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 3, 0 - 4, 0, 0 - 2, 0 - 16, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 0 - 5, 0 - 10, 0, 1, 0 - 10, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz

        swapEdge 10, 0 - 16, 0, 20, 0 - 16, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 15, 0 - 16, 0, 15, 0 - 4, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz

        swapEdge 27, 0 - 16, 0, 27, 0 - 4, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 37, 0 - 16, 0, 37, 0 - 4, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
        swapEdge 27, 0 - 10, 0, 37, 0 - 10, 0, $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz
    }
}

$rc = 0
$oldrx = $rc * 0.65
$oldry = $rc * 1.31
$oldrz = $rc * 0.65

drawObject $oldrx, $oldry, $oldrz, $animateLetters

while $rc <= 550 {
    $rc = $rc + $step
    $newrx = $rc * 0.65
    $newry = $rc * 1.31
    $newrz = $rc * 0.65

    swapObject $oldrx, $oldry, $oldrz, $newrx, $newry, $newrz, $animateLetters

    penwidth 3
    drawObject $newrx, $newry, $newrz, $animateLetters

    $oldrx = $newrx
    $oldry = $newry
    $oldrz = $newrz
}

clear
penwidth 3
drawObject 550 * 0.65, 550 * 1.31, 550 * 0.65, 1

pencolor 255, 255, 255
fontsize 34
go 300, 580
go 415, 315
spriteshow`;
