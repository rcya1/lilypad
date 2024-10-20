---
title: Home Networking
date: 2024-10-19
order: 8
---

## Home Networking

Different eras of home networking:

0. Built on top of the telephone network

- Still not in the home yet, very large computers
- Computers would connect over a network and just talk serially
- A modem would literally be a speaker next to a telephone used to send signals over existing infrastructure
- It had to connected to a physical telephone handset because:
  - The telehpones were still owned by the phone company
  - There wasn't an interface that you could plug into, you had to use the hardware they provided
- Eventually they were switched to have a modem just be directly connected to the network after the phone networks were sued

1. Bringing it to Home

- Microprocecssor has started to bring these into homes
- Starts using TCP
- Packets are transformed into serial data and then just passed along the modem
  - Through protocols like SLIP and PPP
- 2.4 kbits/s

2. Ethernet

- Instead of having to speak serially over the line, it could now just communicate over ethernet
- For devices to learn their local IP addresses, they talk to a DHCP server
- There is a router that is the border between you and the rest of the Internet
  - Has a very simple routing table that just sends things to one port if it starts with a local thing and one port if it is anything else

3. Local Ethernet Network

- Now let's say we have multiple computers on our home network
- So before things go out to the router through the modem, we have a switch that connects to two different computers
- Nothing else needs to change since our router just needs to know which range to send to the local network and which range to send to the outside world

4. Local Router Subnet

- It's annoying for the ISP to handle the DHCP server for you
- Instead they're just going to allocate you a certain subnet and let you handle that
  - So you're going to run the DHCP server locally
- Now the ISP can just update their routers to just send stuff for your subnet to your router

5. Wireless

- Now to connect to your switch, you can use wlan0 instead of eth0 to connect via WiFi
- After here, everything goes downhill

6. ISPs Not Giving Subnets

- As more and more people wanted to come to the internet, the ISPs started charging for giving you subnets
  - Instead, they would just give you one IP address
  - They would give you a /32 instead of a /24
- You're gonna have at home a single computer on the Internet
- Our home network is going to have to be off the main Internet
  - Each thing in our private network will have its own private IP address
- To set up a TCP connection, you can set up one with your single computer and then that single computer will make a connection along the actual world
  - Uses router as a proxy
  - Also called jump host or bastion
  - You can still set this up on your web browser to do this

7. Transparent Proxy

- Instead of making the client do this process of setting up the proxy, the router can transparently do this for the client whenever it receives a connection request

8. Network Address / Port Translator (NAT / NAPT)

- Instead of having to maintain all of this TCP logic in the router, we're going to just simplify everything because the endpoints are already handling that
- Instead, we're going to just have the router retransmit the TCP packets and keep track of which ports match up with each other
- Not really a proxy anymore, just a translator
