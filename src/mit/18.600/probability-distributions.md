---
title: Probability Distributions
date: 2024-09-04
order: 1
---

## Discrete

### Binomial

If you toss $n$ coins, each of which has probability $p$ to be heads, what is the number of heads?

$$
\begin{align*}
P(X = k) &= {n \choose k} p^k (1-p)^{n - k} \\
\exp{X} &= np \\
\var{X} &= np(1-p)
\end{align*}
$$

### Geometric

If you toss coins, each of which has probability $p$ to be heads, how many flips until you get a heads?

$$
\begin{align*}
P(X = k) &= (1-p)^{k-1}p \\
\exp{X} &= 1/p \\
\var{X} &= (1-p) / p^2
\end{align*}
$$

### Negative Binomial

Same as before, but what is the number of tosses before $r$ heads? Basically the sum of $r$ geometric variables.

$$
\begin{align*}
P(X = k) &= {k - 1 \choose r - 1} p^{r-1}(1-p)^{k-r}p \\
\exp{X} &= r/p \\
\var{X} &= rq/p^2
\end{align*}
$$

## Poisson

### Poisson

Assume that you divide time into a large number of small increments and that each increment has an equal probability of something happening.

I.e. suppose a coin comes up heads with probability $\lambda / n$ and you toss it $n$ times. For $k << n$, then it can become Poisson.

$\lambda$ can be interpreted as average number of times an event occurs in a given timespan.

$$
\begin{align*}
P(X = k) &= \frac{\lambda^k}{k!} e^{-\lambda} \\
\exp{X} &= 1 / \lambda
\var{X} &= 1 / \lambda
\end{align*}
$$

### Exponential

Represents the time between events in a Poisson process

Has a memoryless property where given that we've seen no event up to time $b$, the conditional distribution of the remaining time is still the same

$$
\begin{align*}
f_X(x) &= \lambda e^{-\lambda x} \\
\exp{X} &= 1/\lambda \\
\var{X} &= 1/\lambda^2
\end{align*}
$$

If $X$ and $Y$ are exponential with parameters $\lambda_X$ and $\lambda_Y$, then $\min(X, Y)$ is exponential with parameter $\lambda_X + \lambda_Y$

The maximum of iid exponentials can be thought of as the time until all exponentials "go off." The time between exponential "going off" is the min of all remaining exponentials. Therefore, $T_i$, the time between the $i-1$ th and $i$ th particle is exponential with parameter $(n + 1 - i)\lambda$

### Poisson Process

$N(t)$ is the number of events that occur in first $t$ units of time such that probability dist of number of events in an interval depends only on the length of the interval

It is parameterized by $\lambda$ such that the number of events that occur in an interval with length $n$ is Poisson with parameter $\lambda \cdot n$

The time between any events is exponential with parameter $\lambda$

## Continuous

### Uniform

$$
\begin{align*}
f_X(x) &= 1/(\beta - \alpha) \text{ if } x \in [\alpha, \beta] \\
\exp{X} &= \frac{\alpha + \beta}{2} \\
\var{X} &= \frac{(b - a)^2}{12}
\end{align*}
$$

### Gamma

For an exponential $X$ with $\lambda = 1$, we can derive the Gamma function as an extension of function $(\alpha - 1)!$ to the real numbers:

$$
\begin{align*}
\Gamma(\alpha) = \exp{X^{\alpha - 1}}
\end{align*}
$$

Using this, we extend an exponential random variable from time until a single event to time until $\alpha$th event. Equivalent to the sum of iid exponential random variables

$$
\begin{align*}
f_X(x) &= \frac{\lambda^\alpha }{\Gamma(\alpha)} x^{\alpha - 1} e^{-\lambda x} \\
\exp{X} &= \alpha / \lambda \\
\var{X} &= \alpha / \lambda^2
\end{align*}
$$

### Beta

Suppose we have a coin with probability $p$ but we don't know what $p$ is. If we get $a - 1$ heads and $b - 1$ tails, then what is $p$?

$$
\begin{align*}
f_X(x) &= \frac{\Gamma(a + b)}{\Gamma(a)\Gamma(b)} x^{a-1}(1-x)^{b-1} \\
\exp{X} &= \frac{a}{a+b} \\
\var{X} &= \frac{ab}{(a+b)^2(a+b+1)}
\end{align*}
$$
