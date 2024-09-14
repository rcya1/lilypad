---
title: Congestion Control
date: 2024-09-13
order: 2
---

## Congestion Control

### Congestion Control Problem

- What is the congestion control problem?
  - Matching the rate of sending to the capacity of the network
- Simplest version of problem:
  - $n$ senders, $n$ destinations with one bottleneck link in between all of them
    ![](img/simple.png)
  - Servers labeled $S_1, \dots, S_n$ and $D_1, \dots, D_n$
  - Capacity of bottleneck links is $C$
  - Going to assume all packets have the same size
    - It will matter later
    - For now, we will just use this, so we can label $C$ as packets / second
- We're not going to worry too much about fairness today, but it will turn out to be important
  - There are multiple notions of fairness
  - We will worry about just not making it overly unfair
- We often care about efficiency / utilization
  - What fraction of the bottleneck link are we using
- We want scalability to bigger networks
- There are other concerns like packet delay / latency but we won't worry about them

---

- Congestion collapse:
  - As the network slows down, people start retransmitting packets that are stuck in long queues and this causes even more overload
  - Makes efficiency harder to achieve
- Big key goal of congestion control is to avoid congestion collapse

---

- If we plot offered load (i.e. how much load all of the senders want to send) vs actual throughput (i.e. how many packets of useful work is being received), what do we expect the curve to look like?
  - Should scale with offered load until it reaches the maximum $C$
    ![](img/offered-load-vs-throughput.png)
- Problem: we need to handle bursts of traffic
  - We add queues to help this transient congestion, but it doesn't solve persistent congestion
  - This allows us to operate slightly past the "knee" but at some point we will start to drop packets and it will lead to congestion collapse
  - This leads to the dip
    ![](img/congestion-collapse-graph.png)
  - We need to avoid our queues becoming too long to avoid congestion collapse
- To avoid congestion collapse, early implementations of TCP tried to estimate the RTT and deviations from the RTT to calculate timeouts for when a packet is marked as dropped
  - These would adapt to delays present in the network
  - Use this to inform when you re-send it (leads to congestion control algorithm)
- To really get a better sense of the amount of congestion in the problem, we will need to improve our algorithm

## Congestion Control Algorithm

- We're going to assume all packet drops are due to congestion
  - Then, number of packet drops (measured through lack of ACKs) is our measure of congestion
- All of the action for congestion control is happening end to end
  - The routers are just sitting with queues and dropping packets
- Key Idea: When you drop a packet, re-transmit it but slower
- This idea requires everyone to be cooperating
  - We will hear more about rotten mechanisms later

### Windows

- We have a window that determines which packets we can send
- If window size is 4, we can send packets 1, 2, 3, 4
  - We can only send 5 once we get an ack for 1
- **Linear Controls**:
  - When no congestion, for each RTT, window size goes from $W$ to $(1+b_I)W + a_I$
  - When there is congestion, window size goes to $(1 - b_C) - a_C$
  - Typically, you just have for each part either just a multiplicative increase or an additive increase (or decrease)
- The only scheme that achieves convergence to highest utilization and convergence to equitable is:
  - Additive increase, multiplicative decrease
- To see why this situation is good, let's consider $n = 2$:
  - Efficient: $W_1 + W_2 = C * RTT$
  - Fairness: $W_1 = W_2$
  - We'd like something in the ideal world to converge to the point where these intersect
- Any time we're below the efficiency line, we're uncongested so both algorithms will increase
  - This will lead to moving closer to the efficiency line
    ![](img/towards-efficiency.png)
  - When we cross the efficiency, we're going to be congested and move towards the origin
    - Both are going to decay by some multiplicative factor
      ![](img/towards-efficiency-2.png)
  - One note, even if we are not on the $W_1 + W_2 = C * RTT$ line, it just means we aren't congesting, so we could still be getting good utilization if there is at least one thing in the queue at all times
- TCP algorithms, to increase convergence speed, use a slow start phase that uses multiplicative increase and multiplicative decrease to hit congestion

## TCP Tahoe

- The first version of TCP with built in congestion control algorithms
- From the late 80s
- Slow start phase:
  - `SSThresHold`: the window size that TCP believes is safe to use
    - This is initialized to `AWS`
    - This is halved when we detect a packet loss
  - `CWND`: the current congestion window size
    - Doubles every RTT when there is no packet drop
    - It does this by every time we receive an ACK, we increase window size by 1
      - What this means is that when I send $1, 2, 3, 4$, and I receive ack for $1$, I can send both $5$ and $6$ now
      - Receiving a new ACK is defined as receiving a higher ACK number than the latest received one
        - Remember that an ACK is sent back with the number of the highest number such that everything up to that number has been received
  - Ends when `CWND` surpasses `SSThresh` OR if there is a packet loss
    - If packet loss, then, `SSThresh` is halved and we restart
    - So we only leave cold start when `CWND > SSThresh`
      - Signifies that we are in "uncharted" territory and we need to increase the congestion window slower
  - During this entire process, TCP is measuring RTT to get an update
- Congestion avoidance phase:
  - `CWND` increases by 1 every RTT when there is no packet drop
    - Effectively done by increasing by $1 / \text{CWND}$ after each ACK
  - When a packet is dropped, set `SSThresh` to `CWND / 2` and then go to the slow start phase
- Fast retransmit:

  - When a packet is dropped, the packets that follow the dropped one will trigger duplicate ACK messages
  - However out of order packets will also result in duplicate ACKs
  - To avoid misinterpreting duplicate ACK as packet loss, the TCP will conclude packet loss after receiving 3 duplicate ACKs (4 identical ACK packets)
  - This will cause the lost packet to be transmitted immediately and enter the slow start phase

![](img/tcp-tahoe.png)

## TCP Reno

- Adds Fast Recovery to TCP Tahoe
- We try to distinguish between heavy congestion and moderate congestion

  - If there is heavy congestion, we must reduce the network traffic drastically so everything should slow start
  - If there is moderate congestion, a slow start is too drastic
    - Better would be to reduce `CWDN` by half and remain in congestion avoidance movie

- To detect moderate congestion, can realize that many packets will still get through, so there will be many duplicate ACK messages

  - We end up using that same number (3) to determine whether or not we are in moderate congestion
  - So we piggyback on the code to trigger fast retransit

- So when we receive 3 duplicate ACKs, we instead:

  - Set `SSThresh` to `CWND / 2`
  - Set `CWND = SSThresh + 3`
    - Idea is that this was triggered by 3 packets after the dropped, so the network could handle these bytes
  - We will stay in congestion avoidance

![](img/tcp-reno.png)

## Optimal Buffer Size

- In steady state with TCP Reno, we constantly sawtooth between $W_\min$ and $2W_\min$
  - We are on average at $1.5W_\min$, which means that if $2W_\min$ is our network capacity (with no queue) then we are only at 75% usage of our link
- We want 100% usage, so $W_\min \geq C * RTT$, which is the **bandwidth delay product**
  - This is the maximum bandwidth that can be sent on the link
- To actually let us get up to $2 * W_\min$ when we have $W_\min$ be the maximum, our buffer should be of size $W_\min$
