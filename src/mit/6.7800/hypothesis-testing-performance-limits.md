---
title: Hypothesis Testing Performance Limits and Randomization
date: 2025-02-14
order: 3
---

## Hypothesis Testing Performance Limits

We look at fundamental performance limits of binary hypothesis testing

- So far, we have looked at deterministic decision rules
- We need to expand our scope to randomized decision rules as well

### Discrete Likelihood Ratios

So far, we have looked at continuous hypotheses and therefore continuous likelihood ratios

- However, one example is when our data is discrete, and therefore our likelihood ratio is also discrete
- The OC-LRT can also therefore be discrete
- They can also arise even when the data is continuous, and the hypotheses probability distribution are discrete

![](img/oc-lrt-discrete.png?maxwx=0.5)

**Bayesian Criterion**

- When the LRT has discrete components, the probability of the LR being equal to $\eta$ can be non-zero
- In these cases, we said it doesn't matter which decision the LR made
- In such cases, there are at least $2$ points on the OC-LRT corresponding to the optimal Bayesian rule
  - One each corresponds to the possible decision that the LR could make
  - They have the same Bayes risk, but would hve different $(P_F, P_D)$
- If it occurs with probability $0$, then we are guaranteed a single point on the OC-LRT

**Neyman-Pearson Criterion**

- Previously, we had a continuous function so we could just look for where the OC-LRT intersects with $P_F = \alpha$
- Since the OC-LRT can now be discontinuous, we instead look for the largest $P_F$ such that $P_F \leq \alpha$
- However, this leads to obvious problems with the OC-LRT
  - We addresse this with randomization in these areas

![](img/oc-lrt-gap.png?maxwx=1.0)

### Improving Neyman-Pearson via Randomization

- We consider randomizing between an arbitrary pair of LRTs with thresholds $\eta'$ and $\eta''$
  - For some $p$, we generate a binary random variable that determines which one we use
- This achieves:
  $$
  \begin{align*}
  P_D &= pP_D(\eta') + (1-p)P_D(\eta'') \\
  P_F &= pP_F(\eta') + (1-p)P_F(\eta'') \\
  \end{align*}
  $$
  - We draw a line between the OC-LRT points with $\eta$ and $\eta''$ respectively
- An equivalent formulation with $\eta' < \eta''$ is to have:
  - Below $\eta'$, we choose $H_0$
  - Above $\eta''$, we choose $H_1$
  - In between, we choose $H_0$ with probability $p$

![](img/oc-lrt-np-rand.png?maxwx=1.0)

Suppose we have $\eta'' = \eta' + \varepsilon$ and we take $\varepsilon$ to be sufficiently small

- This results in a limit where we have a test such that we choose $H_0$ if $L(y) < \eta'$, $H_1$ if $L(y) > \eta'$ , and $H_0$ with probability $p$ if $L(y) = \eta'$

### Performance Limits of Randomized Tests

||theorem Bayesian Performance Limit
A randomized test cannot achieve a lower Bayes' risk than the optimum LRT in binary Bayesian hypothesis testing
||

Remember that the Bayes risk incorporates our prior probabilities

- Result is that the deterministic test we derived previously is optimal
- One way to think about this is to consider the idea that minimizing Bayes risk is finding smallest value such that the line `Bayes risk = value` intersects the efficient frontier
  - Since randomization can only expand the convex hull, there is no way for it to make a new point that has lower Bayes risk than something else

||theorem Neyman-Pearson Lemma
Given hypotheses $p_{y|H}(y|H_0), p_{y|H}(y|H_1)$ and an $\alpha \in [0, 1]$, there exists a decision rule of the form:

$$
q_*(y) = \begin{cases}
0 & L(y) < \eta \\
p & L(y) = \eta \\
1 & L(y) > \eta \\
\end{cases}
$$

such that $P_F(q_*) = \alpha$ and $P_D(q_*) \geq P_D(q)$ for any decision rule satisfying $P_F(q) \leq \alpha$

A specific $\eta$ and $p$ that work are:

- Choose $\eta$ to be the smallest $\eta$ such that $P_F(\eta_0) \leq \alpha$
- If the inequality is strict, then choose:
  $$
  p = \frac{\alpha - P_f(\eta)}{P(L(y) = \eta | H = H_0)}
  $$
- Otherwise, we choose $p = 0$
  ||

This result implies that among all of the way we could have chosen to create a randomized Neyman-Pearson test, this form is optimal

- Essentially, the choice of $p$ is to bridge the gap between $\alpha$ and $P_f(\eta)$
  - When we don't need to bridge the gap, we get a deterministic rule
- More analysis can be done to show that no other randomized decision rule can perform as well, so this is actually the unique optimal form

### Neyman-Pearson Function

||definition Neyman-Pearson Function
For a given $\alpha$ and a model, we have $\zeta_{NP}{\alpha} = P_D(q_*)$ with $q_*$ chosen such that $P_F(q_*) = \alpha$
||

||definition Efficient Frontier of Operating Points
$$\mc{F}_{p_{y|H}} = \curly{(P_F, P_D) : P_D = \zeta_{NP}(P_F)}$$
||

**Properties**:

- $\zeta_{NP}(1) = 1$
- $\zeta_{NP}(P_F) \geq P_F$
  - For all points $(P_D, P_F)$, we have $P_D \geq P_F$
  - We can do this by considering the randomzied decision rule $q(y) = p$, where we ignore the data
    - This obtains $(p, p)$ for all $p$, so we can always do at least this well
- $\zeta_{NP}$ is concave
- For a threshold $\eta_0$ such that the $P(L(y) = \eta_0) = 0$:
  - The corresponding operating point lies on $\mc{F}_{p_{y|H}}$
  - Both $P_F$ and $P_D$ are continuous w.r.t $\eta$ at $\eta = \eta_0$
  - The slope of $\zeta_{NP}$ at $P_F(\eta_0))$ is equal to $\eta_0$

If a frontier curve achieves a point $(P_F^*, P_D^*)$, then the reversed decision rule can achieve $(1 - P_F^*, 1 - P_D^*)$

- Therefore, the reflection of the efficient frontier curve creates a lower bound $\tilde{\mc{F}}$ on achievable $P_D$ for a given $P_F$
- Any operating point between these two curves is achievable using a randomized decision rule that selects between the two
- Therefore, the region of achievable operating points is a convex hull of the OC-LRT and its reflected version
