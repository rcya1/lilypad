---
title: Minimax Hypothesis Testing
date: 2025-02-19
order: 4
---

## Minimax Hypothesis Testing

So far, we have two approaches to hypothesis testing:

- Bayes testing where we minimize the Bayes risk $\exp{C(H, f(y))}$
- Neyman Pearson testing avoids assigning priors and costs, and tries to maximize the detection probability while keeping the false-alarm probability below a threshold

A third option we will explore here is when we can assign costs, but not come up with priors

- We adopt an adversarial model, where we assume nature will pick the most detrimental prior for whatever decision rule we choose
- We then pick the best possible model, assuming nature will do this

Nature and us are both allowed to use randomized models

- $\varphi(p, r)$ denotes the Bayes risk of our model $r$ assuming the prior probability of being $H_1$ is $p$
  - We also define $\varphi_0(r)$ and $\varphi_1(r)$ as the conditional Bayes risk
- $\varphi_M(r)$ is the max value $\varphi$ can take overall values $p$ for a given $r$
- $r_M$ is then the argmin of $\varphi_M(r)$

An **equalizer rule** is a rule $r$ where $\varphi_0(r) = \varphi_1(r)$

- The Bayes risk does not depend on the $p$
- These will play a special role in the coming analysis

### Example

Consider a threshold of $\eta = (1 - p) / p$

- Corresponds to Bayesian likelihood test with unit costs and a prior $p$

The probability of error is then:
$$P_e = (1-p)P_F\cdot \frac{1-p}{p} + p\p{1-P_D \cdot \frac{1-p}{p}}$$

- This is shown in blue below (the matched $P_e$ curve)

![](img/minimax-1.png?maxwx=0.7)

Suppose the prior is still $p$ but we use a Bayesian likelihood test designed for a prior $q$ that uses a threshold $(1 - q) / q$

The probability of error is then:
$$P_e = (1-p)P_F\cdot \frac{1-q}{q} + p\p{1-P_D \cdot \frac{1-q}{q}}$$

- This is a linear function of $p$ for any $q$
- We want to choose our $q$ anticipating that nature will choose the $p$ to maximize the resulting expression
- For $q = 2/3$, this is shown in red above

When the slope of the line is positive, nature will choose $p = 1$ and when it is negative it will choose $p = 0$

- To minimize the effect of this, we can choose the point such that the slope is $0$
- This is choosing the equalizer rule where no matter what nature chooses as $p$, the $P_e$ is the same

This is a toy example, and there are many factors to consider:

- What if the matched $P_e$ curve does not have a point of zero slope?
- What if it isn't smooth?
- What if we have other cost criteria
- Can we do something better than a LRT?

### Mismatched and Matched Bayes Decision Rules

We have the general form a randomzied likelihood test as:
$$r_B(y; p, \lambda) = \begin{cases}1 & L(y) > \eta \\ \lambda & L(y) = \eta \\ 0 & L(y) < \eta\end{cases}$$
where
$$\eta = \frac{1-p}{p} \cdot \frac{C_{10} - C{00}}{C_{01} - C{11}}$$

The randomization cannot improve a Bayes decision rule

- This is because the costs are equal when $L(y) = \lambda$, so randomizing doesn't change anything

In the Neyman-Pearson hypothesis testing, it does help

- Every point on the efficient frontier can be achieved by some $p, \lambda$ combination

||definition Mismatch Bayes Risk
The **mismatch Bayes risk** is:
$$\varphi_B(p, q, \lambda) = \varphi(p, r_B(\cdot, q, \lambda))$$
||

||definition Matched Bayes Risk
The **matched Bayes risk** is:
$$\varphi^*_B(p) = \varphi(p, r_B(\cdot, p, \lambda))$$
||

- We omit $\lambda$ because we know it is not affected by randomization

||theorem Property 1
$\varphi_B(\cdot, q, \lambda)$ is linear and of the form:
$$\varphi_B(p, q, \lambda) = \varphi_B^0(q, \lambda) + p\paren{\varphi_B^1(q, \lambda) - \varphi_B^0(q, \lambda)}$$
where $\varphi_B^i(q, \lambda)$ is the conditional Bayes risk assuming that $H_i$ is true
||

||theorem Property 2
$\varphi_B(p, q, \lambda)$ is lower bounded by $\phi_B^*(p)$ with equality if $q = p$
||

||theorem Property 3
$\varphi_B^*$ is concave and continuous on $[0, 1]$
||

||theorem Property 4
$\varphi_B^*(0) = C_{00}$ and $\varphi_B^*(1) = C_{11}$
||

![](img/minimax-2.png?maxwx=0.9)

### Minimax Decision Rule

||definition Minimax Decision Rule
A minimax decision rule is a rule $r_M$, also known as $r_*$ that corresponds to a decision rule with prior $p_*$ and randomization parameter $\lambda_*$ such that:
$$\min_r \max_p \varphi(p, r) = \varphi(p_*, r_*) = \varphi_B^*(p_*)$$
||

||theorem Theorem
When there exists $P_F^*$ such that $\zeta_NP(P_F^*) = g_M(P_F^*)$ with $g_M$ defined as:
$$g_M(P_F) = \frac{C_{01} - C_{00}}{C_{01} - C_{11}} - \frac{C_{10} - C_{00}}{C_{01} - C_{11}} \cdot P_F$$
then $(P_F^*, \zeta(P_F^*)$ corresponds to an optimizing pair $(p_*, \lambda_*)$

Otherwise, if $g_M(P_F^*)$ is below the efficient frontier, then $p_0^* = 0$, and if it is above, then $p_0^* = 1$
||

- The core idea is to draw the linear function $g_M$ and check where it intersects the efficient frontier of points
  - For valid costs, this will always have a negative slope
- If the OC-LRT originally intersects $g_M$, then there is no need for randomization and the parameter $\lambda$
  - Recall that the $\lambda$ is just to bridge the gaps
- $p_*$ is the prior nature should choose to make the system perform as poorly as possible
  - Known as the **least favorable prior**
- A core fact behind the proof is that $\varphi(p, r)$ has a saddle point, i.e. that it satisfies the minimax theorem:
  - $\min \max \varphi = \max \min \varphi$

||theorem Corollaries
If $r_B$ is a minimax decision rule, then $p_* \in \t{argmax}_p \varphi_B^*(p)$

$r_B(\cdot; p_*, \lambda_*)$ is an equalizer rule when $p\_\* \in (0, 1)

- If there is an $r_B$ that is an equalizer rule with $p \in (0, 1)$, then it is a minimax decision rule

$r_B(\cdot; p_*, \lambda)$ is a minimax decision rule for any $\lambda$ when $p_* \in \{0, 1\}$
||
