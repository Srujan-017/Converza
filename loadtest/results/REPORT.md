# Converza load test report

Machine: AMD Ryzen 5 7520U with Radeon Graphics, 8 logical cores, 7.3 GB RAM (Windows_NT 10.0.26200)
Each run: participants join, settle 20s, then stats are measured over 15s.
- **phase6-mesh**: 2026-10-18, 18 runs, url http://localhost:3000
- **phase6-sfu**: 2026-10-18, 18 runs, url http://localhost:3000

Values are the median across repeats, with the range in brackets.

All participants run on this one machine, so its CPU is shared by everyone and
there is no real internet in between. Compare columns with each other rather than
reading the numbers as what each real user would get on their own device.

## Videos each person uploads

| People | phase6-mesh | phase6-sfu |
|---|---|---|
| 2 | 1.0 | 1.0 |
| 3 | 2.0 | 1.0 |
| 4 | 3.0 | 1.0 |
| 5 | 4.0 | 1.0 |
| 6 | 5.0 | 1.0 |
| 8 | 4.8 (4.3-4.9) | 1.0 |

## Upload per person

| People | phase6-mesh | phase6-sfu |
|---|---|---|
| 2 | 1.73 Mbps (1.66-1.73) | 1.73 Mbps |
| 3 | 3.46 Mbps | 1.73 Mbps |
| 4 | 5.11 Mbps (5.03-5.21) | 1.73 Mbps |
| 5 | 3.73 Mbps (3.73-3.81) | 1.73 Mbps (1.73-1.74) |
| 6 | 1.38 Mbps (1.21-1.50) | 1.60 Mbps (1.20-1.62) |
| 8 | 0.70 Mbps (0.63-0.80) | 0.51 Mbps (0.45-0.69) |

## Download per person

| People | phase6-mesh | phase6-sfu |
|---|---|---|
| 2 | 1.73 Mbps (1.66-1.73) | 1.73 Mbps |
| 3 | 3.46 Mbps | 3.46 Mbps (3.45-3.46) |
| 4 | 5.11 Mbps (5.05-5.22) | 5.20 Mbps (5.19-5.20) |
| 5 | 3.65 Mbps (2.22-3.65) | 6.92 Mbps |
| 6 | 1.29 Mbps (1.17-1.46) | 8.03 Mbps (5.96-8.08) |
| 8 | 0.47 Mbps (0.28-0.54) | 3.64 Mbps (2.64-3.93) |

## Received video smoothness

| People | phase6-mesh | phase6-sfu |
|---|---|---|
| 2 | 30.0 fps (28.6-30.0) | 30.0 fps (29.9-30.0) |
| 3 | 29.9 fps (29.9-30.0) | 30.0 fps |
| 4 | 28.9 fps (27.8-29.6) | 30.0 fps (29.8-30.0) |
| 5 | 19.9 fps (17.1-21.2) | 30.1 fps (30.0-30.1) |
| 6 | 16.6 fps (16.0-16.6) | 25.9 fps (22.9-26.7) |
| 8 | 8.1 fps (6.9-10.6) | 18.4 fps (15.8-20.3) |

## Picture height sent

| People | phase6-mesh | phase6-sfu |
|---|---|---|
| 2 | 480p | 480p |
| 3 | 480p | 480p |
| 4 | 480p | 480p |
| 5 | 348p (342-366) | 480p |
| 6 | 264p (252-272) | 480p (460-480) |
| 8 | 280p (268-284) | 420p (285-480) |

## Remote video frozen

| People | phase6-mesh | phase6-sfu |
|---|---|---|
| 2 | 0.0% of time (0.0-1.3) | 0.0% of time |
| 3 | 0.0% of time | 0.0% of time |
| 4 | 0.0% of time (0.0-0.1) | 0.0% of time |
| 5 | 31.5% of time (25.9-32.4) | 0.0% of time |
| 6 | 20.9% of time (19.8-28.8) | 0.4% of time (0.1-2.9) |
| 8 | 14.2% of time (9.0-16.2) | 11.9% of time (1.3-22.9) |

## People receiving video from everyone

| People | phase6-mesh | phase6-sfu |
|---|---|---|
| 2 | 100% | 100% |
| 3 | 100% | 100% |
| 4 | 100% | 100% |
| 5 | 100% | 100% |
| 6 | 83% (83-100) | 100% |
| 8 | 0% | 88% (0-100) |

## Peer connections one person opened (most)

| People | phase6-mesh | phase6-sfu |
|---|---|---|
| 2 | 3 | 4 |
| 3 | 6 | 4 |
| 4 | 10 | 4 |
| 5 | 15 | 4 |
| 6 | 21 | 4 |
| 8 | 36 | 4 |

## Laptop CPU (all participants)

| People | phase6-mesh | phase6-sfu |
|---|---|---|
| 2 | 45% (45-68) | 45% (43-59) |
| 3 | 64% (60-68) | 50% (50-56) |
| 4 | 95% (95-100) | 61% (56-69) |
| 5 | 94% (92-97) | 78% (72-80) |
| 6 | 96% (95-97) | 100% (100-100) |
| 8 | 92% (91-94) | 96% (94-97) |

## SFU server CPU

| People | phase6-mesh | phase6-sfu |
|---|---|---|
| 2 | - | 5% of 1 core (2-6) |
| 3 | - | 12% of 1 core (9-15) |
| 4 | - | 24% of 1 core (12-27) |
| 5 | - | 31% of 1 core (28-39) |
| 6 | - | 53% of 1 core (49-54) |
| 8 | - | 44% of 1 core |
