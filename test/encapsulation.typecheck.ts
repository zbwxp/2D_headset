// Compile-time encapsulation checks (dot 1791427188). This file is never run;
// `tsc --noEmit` (and test/typecheck.test.ts) fails if any line below compiles.
import * as net from '../src/network'
import * as groups from '../src/groups'
import * as joins from '../src/joins'
import * as links from '../src/links'
import * as fills from '../src/fills'

const n = net.create()
// @ts-expect-error the network state is opaque: no direct field access
n.points.push()
// @ts-expect-error read results are readonly
net.point(n, 'a').position = { x: 1, y: 1 }
// @ts-expect-error vectors are readonly
net.point(n, 'a').position.x = 3
// @ts-expect-error the line list is a readonly copy
net.lines(n).push(net.line(n, 'x'))
// @ts-expect-error opaque groups state
groups.create().groups
// @ts-expect-error opaque joins state
joins.create().rows
// @ts-expect-error opaque links state
links.create().pairs
// @ts-expect-error opaque fills state
fills.create().loops
