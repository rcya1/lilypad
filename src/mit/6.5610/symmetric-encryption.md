---
title: Symmetric Encryption
date: 2025-02-05
order: 2
---

## Symmetric Encryption

### Summary

- Define symmetric encryption
- Define CPA-secure
- Define PRFs
  - Counter mode
  - ChaCha20
- Define PRPs
  - Switching Lemma
  - Cipher-Block Chaining
  - AES / DES Design

### Encryption Schemes

||definition Encryption Scheme
A symmetric encryption scheme is associated with a key space $\curly{\mathcal{K}_\lambda}_{\lambda \in \naturals}$, a message space $\{\mathcal{M}_\lambda\}_{\lambda \in \naturals}$, and a ciphertext space $\{\mathcal{C}_\lambda\}_{\lambda \in \naturals}$ with two algorithms Enc and Dec with:
$$\text{Enc}_\lambda : \mathcal{K}_\lambda \times \mathcal{M}_\lambda \rightarrow \mathcal{C}_\lambda$$
$$\text{Dec}_\lambda : \mathcal{K}_\lambda \times \mathcal{C}_\lambda \rightarrow \mathcal{M}_\lambda$$
||

We define the correctness of the encryption scheme if:

$$\text{Dec}_\lambda(k, \text{Enc}_\lambda(k, m)) = m$$

If our encoders and decoders are probabilistic, then this becomes:

$$\prob{\text{Dec}_\lambda(k, \text{Enc}_\lambda(k, m)) = m} = 1$$

### Defining Security

||definition Take 1
An encryption scheme is secure if for every $\lambda$ and pair of messages $m_0, m_1$, we have:
$$\text{Enc}(k, m_0) \equiv \text{Enc}(k, m_1)$$
for a random $k$
||

- This notation means that the probability distributions, random across the different choices of $k$, are equal for the two messages

A one-time pad that just takes $\text{Enc}(k, m) = k \oplus m$, satisfies this

- However, if the adversary sees more than one message, they can just xor them and get what the xor of the two messages is
  - If they see any plaintext, they can get the key directly out!
- Here, ciphertexts are functions of the secrete key and can leak information about it
- We want to be secure even if the adversary sees many ciphertexts

||definition Take 2
An encryption scheme is secure if for every $\lambda, \ell \in \naturals$ and every message $m_1, \dots, m_\ell, m_1', \dots, m_\ell$ we have:
$$(\text{Enc}(k, m_1), \dots, \text{Enc}(k, m_\ell)) \equiv (\text{Enc}(k, m_1'), \dots, \text{Enc}(k, m_\ell'))$$
for a random $k$
||

This is sufficiently strong, but is impossible to achieve!

- This cannot be possible if the encryption algorithm is deterministic, since otherwise the adversary can tell if the same message was encrypted twice
- This is still impossible because the ciphertext contains some information about the secret key $k$, and eventually with enough ciphertexts, all of the information about $k$ will be given away

We relax the security requirement, and instead of requiring the distributions to be the same, we require that they only look the same to polynomial time adversaries

- We refer to this as **computationally indistinguishable** and use $\approx$ to refer to this

||definition Negligible
A function $\mu : \naturals \rightarrow \naturals$ is negligible if for every $c \in \naturals$, there exists $n_c \in \naturals$ such that for every $n > n_c$, we have $\mu(n) < n^{-c}$
||

||definition Computationally Indistinguishable
Distributions $\mathcal{A}$ and $\mathcal{B}$ are computationally indistinguishable if for every probabilistic polynomial time distinguisher $\mathcal{D}$ there exists a negliglble function $\mu$ such that:
$$\abs{\prob{\mathcal{D}(\alpha) = 1} - \prob{\mathcal{D}(\beta) = 1}} \leq \mu(\lambda)$$
for random $\alpha, \beta$ drawn from $\mathcal{A}, \mathcal{B}$
||

The actual definition is more complicated and even allows the adversary to choose messages adaptively based on previous ciphertexts

||definition CPA Secure
An encryption scheme is secure against adaptively chosen plaintext attacks (CPA secure) if for every PPT adversary $\mathcal{A}$ there exists a negligible function $\mu$ such that for every $\lambda$, $\mathcal{A}$ wins the following game with probability at most $1/2 + \mu(\lambda)$:

- The challenger chooses a key $k \leftarrow \mathcal{K}_\lambda$
- The adversary, given the length $\lambda$, chooses a message $m_i$ and receives $c_i$
  - This can be repeated polynomially many times
- The adversary $\mathcal{A}$ chooses $m_0, m_1$
- The challenger chooses a random message out of the two and sends the corresponding ciphertext back
- The adversary attempts to guess which one of its messages was encrypted

The probability advantage is known as the $\text{CPAAdv}[\mc{A}, \varepsilon]$

- This is $\abs{\prob{W_0} - \prob{W_1}}$ where $W_i$ is the event the adversary outputs $1$ when the message chosen was $i$
  ||

- In the end, we say this is secure if the adversary cannot meaningful gain an advantage in discerning which message was encrypted or not
- The actual definitions of secure are much stronger
  - CPA-secure is useful as a building block but not one you would ever actually use

## Constructing a CPA-Secure Scheme from PRF (Counter-Mode)

If the secret key was infinitely long, we could encrypt all of our messages using a fresh part of the pad, and just tell the user which part of the pad we used

- As long as we do not reuse the same part of the pad, we will have the same security as the one-time pad
- To approximate this infinitely long pad, we could use a perfectly random function $F$ and pass in a random input to it each time
  - $F: \{0, 1\}^\lambda \rightarrow \{0, 1\}$
  - We could just generate a random number to pass into $F$ every time we want to encrypt a message, and as long as we encrypt significantly less than $2^{\lambda / 2}$ messages, we do not expect a collision
  - To this end, we use pseudorandomness

||definition Pseudorandom Functions
A pseudorandom function $F: \mathcal{K} \times \mathcal{X} \rightarrow \mathcal{Y}$ is a function such that for every PPT algorithm $\mathcal{A}$, there exists a negligible function $\mu$ such that:
$$\text{PRFAdv}[\mc{A}, \mc{F}] = \abs{\prob{\mathcal{A}^{F(k, \cdot)} = 1} - \prob{\mathcal{A}^R = 1}} \leq \mu$$
where $k$ is chosen randomly and $R$ is a truly random function. The adversary can access $F$ and $R$ a polynomial number of times and attempt to predict whether or not it is interacting with the pseudorandom function

- In other words, the adversary cannot in reasonable time distinguish this function from a truly random one
  ||

By just using a pseudorandom function in place of the truly random function we get a CPA secure scheme

- If $P = NP$, then these do not exist
- This is because you can use circuit-SAT to find out whether or not there exists a key $k$ plugged into the $\mc{F}$ that results in all of the values you've seen

Formally, this encryption algorithm is known as **counter mode**, or **CTR-mode**

||definition CTR-mode Encryption
Given a PRF $\mc{F}$, we can encrypt a series of messages $(m_1, m_2, \dots, m_\ell)$ where each $m_i$ is $n$ bits long using a key $k$ by computing a $r \leftarrow \curly{0, 1}^n$ and then $outputting:
$$(r, F(k, r) \oplus m_1, F(k, r + 1) \oplus m_2, \dots)$$
||

For all polynomial adversaries $\mathcal{A}$ that make $T$ encryption queries of length $\ell$ messages with blocks of size $n$, there is an adversary $\mathcal{B}$ such that:
$$\text{CPAAdv}[\mc{A}, \varepsilon] \leq 2 \cdot \text{PRFAdv}[\mc{B}, \mc{F}] + \frac{2T^2\ell}{2^n}$$

- If the PRF is secure, then we just need the last term to be negligible, which occurs if $T^2\ell << 2^n$
- With parallel machines, this can lead to fast decryption
- If two machines are in communication with each other, they can avoid sending $r$ each time by just keeping track of a counter that they each increment

### Example of PRF for Counter-Mode (ChaCha20)

ChaCha20 is a stream cipher used in TLS to secure HTTP connections that uses a PRF with counter mode

The ChaCha20 PRF:

- 256 bit key
- 128 bit input
- 512 bit output
- Defines a function $\t{pad}(k, x)$ that maps the key $k$, input $x$, and $128$ bits of constants into a 4x4 matrix of 32 bit values
  - $256 + 128 + 128 = 16 * 32$
- Uses a 512 long permutation $\Pi$
  - This is a public permutation that is defined as doing the following 10 times:
    ![](img/chacha.png?maxwx=0.8)
- It then does $\t{pad}(k, x) \oplus \Pi(\t{pad})$
- This uses no secret / data dependent memory accesses to avoid cache side channel attacks
- This can be optimzied with SIMD instructions

## Pseudorandom Permutations (PRPs)

Pseudorandom permutations (PRPs) are an alternative primitive from PRFs

- Also known as block ciphers
- The most commonly used block cipher is AES, which replaced DES
  - Both of these are extremely widespread

||definition PRPs
A PRP is defined over a keyspace $\mc{K}$ and input space $\mc{X}$ and consists of two algorithms $P$ and $P^{-1}$ that map $\mc{K} \times \mc{X} \rightarrow \mc{X}$ such that:

- For all keys $k \in \mc{K}$, $P(k, \cdot)$ map distinct inputs to distinct outputs
- $P^{-1}(k, \cdot)$ inverts $P(k, \cdot)$
- The $\t{PRPAdv}[\mc{A}, P]$ is defined as the advantage an adversary can get in a game where it tries to distinguish the PRP from an actual random permutation

  - We say $W_i$ is the probability the adversary says it is a random permutation
    ||

- The bitlength of the input space $n$ is the **block size**

There are many ways to use a PRP to make an encryption scheme, which we will go over

### Switching Lemma

We can use a PRP as a PRF if the block size is large enough

- Then we can just use counter-mode encryption
- This is the main approach behind AES-GCM

||lemma PRP Switching Lemma
Let $P$ be a PRP working on inputs of length $n$. For every adversary $\mc{A}$ making at most $T$ queries, we have:
$$\t{PRFAdv}[\mc{A}, P] \leq \t{PRPAdv}[\mc{A}, P] + \frac{T^2}{2^{n}}$$
||

If there is an adversary that can break $P$ as a PRF with $T^2 << 2^n$, it can also break it as a PRP with roughly the same advantage

- If there is no way to break $P$ as a PRP, then this therefore means there cannot be anything breaking it as a PRF

This guarantees nothing when $T^2 \approx 2^n$

- When this is the case, the adversary can efficiently distinguish a PRP from a PRF
- This is because at this point, the Birthday Paradox indicates the adversary is likely to see a collision, telling it that it is a PRF and not a PRP
- Many applications use AES with $n = 128$ bits, so it is not safe to use the same key more than $2^64$ times

### Cipher-Block Chaining

This is historically important, but should never be used in new systems

- It is possible to show this is CPA-secure if the underlying pseudo-random permutation $P$ is secure

We take a randomly generated $c[0]$ (a nonce) and then xor it with $m[0]$

- We then pass it through the permutation to get out the first ciphertext as well as pass it to xor with $m[1]$ and repeat
- We output all of our ciphertext along with $c[0]$ and use the inverse permutation to get the message back

$$\t{CPAAdv}[A, \varepsilon] \leq 2 \cdot \t{PRPAdv}[\mc{B}, P] + \frac{2T^2\ell^2}{2^n}$$

Disadvantages:

- Not parallelizable
- Requires evaluating PRP in forward and inverse directions, which requires more code / hardware
- Ciphertexts must be a multiple of the block size, leading to padding

#### Sweet32 Attack

For small blocks (i.e. $n = 64$), after seeing enough encrypted messages (i.,e. $2^32$), then it is likely to see two ciphertext blocks that are equal

- If $c_i = c_j$, then $c_{i-1} \oplus c_{j-1} = m_i \oplus m_j$

### AES / DES Design

#### Even-Mansour Cipher

$2n$ bit key and $n$ bit block size with a public invertible permutation $\Pi$

- The cipheris just $P_{EM}((k_0, k_1), x) = k_1 \oplus \Pi(x \oplus k_0)$

If we model $\Pi$ as truly random, then this has a PRP advantage of $2T^2 / 2^n$

#### AES

AES is an iterated Even-Mansour cipher operating on a key of size $128, 192$, or $256$

- Block size is fixed at $n = 128$
- Derives "round keys" $k_0, \dots, k_r$ each of length $n$ from the input key $k$ as a linear function of $k$
- AES then does:
  - $st \leftarrow x \oplus k_0$
  - For $i = 1, \dots, r:$, we do $st \leftarrow \Pi(x) \oplus k_i$
  - We output $st$
- For $128$ bit keys, the number of rounds is set at $r = 10$

The public permutation $\Pi$ works as:

![](img/aes.png?maxwx=0.8)

- A naive implementation of SubBytes requires secret dependent memory accesses, which can lead to a side channel attack
- Implementers frown on software AES implementations for this reason

#### DES

- In 1985, the Data Encryption Standard was published but never approved for use since its 56 key length was too short
- AES built on top of a public random permutation
- DES builds on a pseudorandom function

The main idea is to turn a PRF into a PRP with a **Feistel network**

- Uses a $56$ bit keyspace and a $64$ bit block size

- One round of the Feistel network with PRF $F$ is a keyed permutation:
  - $\pi_F(k, (x, y)) = (y, x \oplus F(k, y))$
  - This means that we split the input into a left half ($x$) and a right half ($y$)
- The $\ell$ round Feistel network applies $\pi_F$ many times:
  - $P_\ell((k_1, \dots, k_\ell), (x, y)) = \pi_F(k_\ell, \pi_F(k_2, \pi_F(k_1, (x, y))))$
- It was proven that with $\ell = 3$, this is sufficient to construct a secure PRP
  - $\t{PRPAdv[\mc{A}, P_3]} \leq 3 \cdot \t{PRFAdv}[\mc{B}, F] + \frac{Q^2}{N} + \frac{Q^2}{2N^2}$

The DES cipher is just a 16-round Feistel network with a fixed permutation before and after

- To create the 16 PRFs to use with the Feistel network:
  - 16 round keys $k_1, \dots, k_16$ are all generated as $48$ bit subsets of the bits from the key $k$
  - The round function $F(k_i, \cdot)$ computes initial state as linear fucntion of round key and input, splits state into six-bit chunks and applies differet non-linear functions (known as S-boxes) to each with a lookup table, and then permutes the bits of the state
  - Picking the S-boxes at random actually makes this cipher weak
    - They were specifically constructed to have nice statistical properties
