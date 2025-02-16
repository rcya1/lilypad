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

![](img/oc-lrt-discrete.png?maxwx=0.8)

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

### Improving Neyman-Pearson via Randomization

-
