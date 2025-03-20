---
title: Secure Multi Party Computation
date: 2025-03-13
order: 8
---

## Secure Multi-Party Computation

Suppose a set of $n$ parties denoted by $P_1, \dots, P_n$ with private inputs $x_1, \dots, x_n$ want to compute $f(x_1, \dots, x_n)$ without rebealing anything about each of their inputs

- This is the goal of MPC

Examples:

- Collaborating on financial / healthcare / market research without rebealing each of their inputs
- Machine learning without sharing raw data
- Secure auctions

We assume that every pair of parties has a private and authenticated channel

- We assume the network is synchronous
  - Protocols proceeds in rounds, and at the end of each round, all messages sent were received

Defining **security**:

- Take 1:
  - By the end of the protocol, no party learns any information about the others' inputs
  - This is impossible since everyone learns $f(x_1, \dots, x_n)$
- Take 2:
  - By the end of the protocol, no party learns any information about the others' inputs besides the output $f$
  - This doesn't provide enough security because we want even more
    - Let's say we were implementing an auction
    - We don't want it to be somehow possible for someone else to be able to guarantee outbid someone by 1 even if they don't know that person's bid
- Take 3:
  - The MPC protocol should be as secure as an idealized world where everyone sends their result to a trusted third party and they compute the output
  - We formalize this below

||definition Security
An $n$ party protocol securely computes a function in the presence of at most $t$ corruptions if for every PPT adversary $\mc{A}$ controlling at most $t$ parties, there exists a PPT simulator $\mc{S}$ controlling the same parties in the ideal world such that for any inputs, $\t{Real}_\mc{A}$ and $\t{Ideal}_\mc{S}$ are indistinguishable

- $\t{Real}_\mc{A}$ refers to the output of all parties after running the protocol where the adversarial parties output whatever they want
- $\t{Ideal}_\mc{S}$ is the same story but they all hand their inputs to a secure third-party
  ||

There are two main types of adversaries:

- Malicious: the adversary controlling the parties completely controls them and sends whatever the adversary wants
- Honest-but-curious: an adversary controlling the parties learns their inputs and all messages sent / received, but cannot modify the messages

### BGW Protocol

The BGW protocol consists of three phases:

1. Secret Sharing of Inputs
2. Computation on Shares
3. Reconstruction

#### Secret Sharing of Inputs

Fix a prime $p > n$. Each party then uses Shamir's secret sharing scheme to share their input across $t + 1$ parties:

- Select uniformly at random $t$ coefficients $a_1, \dots, a_t$ from $\t{GF}[p]$ and let:
  $$g_b(x) = b + a_1x + \dots + a_tx^t$$
- Send $g_b(j)$ to party $j$

So now, any subset of $t + 1$ parties can reconstruct any other parties' input by working together

#### Computation on Shares

We think of the function $f$ as some combination of addition and multiplication gates

For addition gates:

- Suppose the inputs to a gate are $a$ and $b$
- These are shared via polynomials $g_a$ and $g_b$
- We need to compute the $i$ th share of $g_{a + b}$
- We note that the definition of $g_{a + b}$ is a random polynomial such that $g_{a+b}(0) = a + b$
  - We note that $g_{a+b} = g_a + g_b$ works
  - Therefore we can compute the $i$ th share of $g_{a + b}$ by $g_{a + b}(i) = g_{a}(i) + g_b(i)$

For multiplication by a constant:

- We can also just use $g_{ca} = c * g_a$

For multiplication gates, it is more complicated:

- We cannot just use $g_{ab} = g_a g_b$
  - This is degree $2t$ !
  - We would need $2t + 1$ parties to reconstruct, and every element is not random because it is the product of two polynomials
- We do two steps to fix this:
  - Degree reduction
  - Rerandomization

**Degree Reduction**: Each party reduces it share of a degree $2t$ polynomial to a share of some degree $t$ polynomial

||theorem Theorem
There exists a constant matrix $A \in \t{GF}[p]^{n \times n}$ such that for every degree $2t$ polynomial $g(x) = h_0 + h_1x + \dots + h_{2t}x^{2t}$, there is a degree $t$ truncated polynomial $\hat{g}(t) = h_0 + h_1x + \dots + h_tx^t$ such that:
$$(\hat{g}(1), \dots, \hat{g}(n))^T = A \cdot (g(1), \dots, g(n))$$
||

With this $A$, we can represent the multiplication instead as:

- Compute $A g_{ab}(i) = A(g_a(i) g_b(i))$
- Share this value around

**Rerandomization**: The problem is this polynomial might not be very random anymore! So we rerandomize the degree $2t$ polynomial before truncating it

- Each party $P_i$ secret shares the value $0$ using a $2t + 1$ secret sharing scheme
  - Namely, each party $P_i$ finds a random $2t$ polynomial $g_i$ such that $g_i(0) = 0$
  - It then sends the values of $g_i(j)$ to party $P_j$
- Each party $P_i$ then sums up all of the values it receives and adds it to its current share of $g_{ab}$
  - Note that this in the end will still evaluate to $ab$ on $0$ since this is the $i$ th share of the polynomial $g_ab + g_1 + g_2 + \dots + g_n$
- This is the polynomial that is then passed into degree reduction

#### Reconstruction

The parties then each send their share of the output to whomever should receive said output

- These parties then reconstruct

#### Security

Intuitively, each party holds random shares and an adversary cannot reconstruct any input with only $t$ controlled parties

- Note that this doesn't rely on cryptography!
- It is information theoreticlly secure

What happens if we have malicious parties who send random junk?

- Recall from Shamir's secret sharing scheme that we can reconstruct even if $\frac{n - t - 1}{2}$ parties are corrupted
- This means that as long as $t < n/3$, then we can reconstruct!
- If the adversary only sends junk on the reconstruction phases, then we are good
- If the adversary sends junk on the secret sharing phase, then it is no longer secure
  - I.e. if it sends things that do not correspond to a degree $t$ function
  - This is fixable if we use a verified secret sharing scheme
    - A dealer "proves" that it send shares corresponding to a degree $t$ polynomial (or degree $2t$ in rerandomization)
    - If we use one of these, then we are fully secure against $t < n/3$ adversaries

One note on the threat model: this does not typically protect against software bugs

- If all parties are running the same software and an attacker finds a bug that can compromise all parties in one go, then the situation is comrpromised
- Instead, what MPC can help with is local compromise:
  - If two companies run an MPC, it protects one from learning more than it should about the others data

### Applications

**Cryptocurrency Secrets**

- In cryptocurrency asset organizations, there is a secret signing key such that anyone holding it can authorize transactions
- You may not trust any one employee with the key, so you split the key among multiple emplyoees
- Rather than using BGW, most companies implement these using special-purpose "threshold signing" protocols
  - These are more complicated / less elegant, but much faster

**Private JOIN for Ad Attribution**:

- Google and Meta use MPC for conversion measurement in online ads
  - See which ads led to a purchase
  - Does this by comparing user information with the advertiser (i.e. BMW)
  - To avoid sharing all data, they use this
- **Private Aggregation**:
- A company ahs millions of clients, each of which holds a value
- The company wants to compute some function over all of them without learning individual ones
- I.e. private telemetry (Apple uses this to produce memories reels in Photos apop)

#### Efficiency of BGW

Many computations do not naturally have nice representations as arithmetic circuits

- A Python script that exercises using RAM can have trillions of gates
- BGW has communication cost scaling linearly with the number of gates
- The number of rounds of communication scales with the depth of the circuit

If the number of parties is in the millions, it may be infeasible for them all to have P2P communication links

- It is hard to nail down who the parties are, and hard to have them agree on shared secrets with each other

In practice, we go away from using BGW / general-purpose MPC protocols and instead on special-purpose ones

- For crytocurrency or private-join, they may use something that looks nothing like BGW and instead very specific protocols
- For private telemtry, companies use a similar protocol that uses no addition gates
  - The simplest example is just a sum circuit, which can actually be used for a number of practical applications

Almost all applications use one of these approaches

- There is no MPC protocol as of today that uses training of neural network via BGW

Another problem is that with millions of parties, there is a lot of communication overhead

- Especially if the number of clients may evolve over time
- A common technique is to work with a client / server model
- Each client secret shares their input to $k << n$ servers, who run the computation amongst themselves
- The downside is security: an attacker now only needs to compromise $k << n$ servers to violate privacy

### Private Aggregation

We explore more the idea of priate aggregation in a client-server model

- Each client splits their data vector into a sum of $k$ random vectors
  - They then send this to each server (equivalent to secret sharing)
  - Each server learns nothing about the client overall vector
- Each server can then sum up all client vectors it receives and then all of them can sum their answers to get the aggregate statistics

#### Malicious Clients

Problem: malicious clients can completely mess up the computation

- Imagine something where each client is sending a vector of which website is their homepage (i.e. each entry in the vector is a website and is 0 or 1)
  - A client could "vote" many times by sending a number > 1
  - Or they could even send negative
  - The server can't tell when this happens or know who to blame
- Servers could use general-purpose MPC to detect and prevent this, but that leads to $O(n)$ communication per client
  - $n$ is the length of the vector

An idea is to have servers check that each client is well-formed before accepting it

- Servers each hold an additive share of a client input $x$
- We can construct a linear function (a sketch) of the input $x$ to compress it to something of length $O(1)$ that summarizes the goodness / badness of the input
  - Then servers could conduct a $O(1)$ size MPC to check the sketch values
  - In this case, we have the servers agree on a random vector $r$ of length $n$
    - They also compute $R$, which has squared entries of $r$
  - They then compute the test values $t_i = \angle{x_i, r}$ and $T_i = \angle{x_i, R}$
  - They use an MPC to check:
    $$(\sum x_i)^2 - \sum x_i = 0$$
- If every element only has $<=1$ non-zero corodinate, then we will have the sum is 0
  - There is very low chance (not formally proven here) that a cheating client can "win"

#### Malicious Servers

The previously described scheme does not protect against a malicious server

- Imagien a server that guesses locations of non-zero element and tries to shift it
  - I.e. they subtract 1 from that location and then add 1 somewhere else
  - If they guess correct, then the verifier accepts
  - If they guess wrong, the verifier wrongs

If we wanted to check more complicated predicates, sketching is insufficient

- I.e. check that $\sum x_i \in \{0, 1\}^n$

We can instead try to do a zero-knowledge proof

- The client is the prover while the servers are the verifiers

Example for the above language:

- Let $x = (x_1, \dots, x_n)$
- Define polynomials $f, g, h$ over a field with:
  - $f(i) = x_i$
  - $g(i) = x_i - 1$
  - $h = f \cdot g$
- If $x \in L$, then: $h(i) = f(i) \cdot g(i) = x_i(x_i-1) = 0$ when $x_i \in \{0, 1\}$ for all $i$
- Otherwise, then there is an $i$ such that $h_i \neq 0$A

Key facts:

- Given shares of $x$, one can compute shares of $f(r)$ and $g(r)$ without communication
- Given shares of coefficient of $h$, can compute shares of $h(r)$ without communication

We then have the following recipe:

1. Client computes the polynomial $h$ and sends shares of $h$ to servers as its proof
2. Servers check that for all $i$, $h(i) = 0$ by computing shares of $h(1), \dots, h(n)$ and then computing a random linear combination of the shares and checking if it is 0
3. Servers check that $f \cdot g = h$ by choosing a random $r$ and computing shares of $f(r), g(r), h(r)$. They then use a $O(1)$ sized MPC to check if $f(r) \cdot g(r) - h(r)$

This idea can actually be generalized to langauges that are computed by arbitrary circuits

-
