---
author: Noah Jones
title: CDT01 Application
date: 2021-08-17
---

# CDT01 Application

## Background

This is a proof of concept or first experiment in generating the application.

## Compliance Considerations

## Plan

The app is used by the customer who did not create the PAB, which
manages it. Btw, the script can make requests to the pab eg give me a
list of utxos at my address. It interacts with the contract on the
chain.

In testing, you first configure the emulator trace monad, set up the
oracle ('checkOracle'), then you have the first wallet set up the
oracle, ... [find more
here](https://github.com/input-output-hk/plutus-pioneer-program/blob/main/code/week06/src/Week06/Oracle/Test.hs)

In my case, I want the client to send money to the bank and a request
to the pab. The pab then checks the ledger against the request (via
the oracle). When the request has gone through, it calls the "mint"
endpoint and requires that the address of the client is paid. The
validator does the same to validate and checks the oracle. This is
done because the money must be paid to the oracle address at which
time the validator checks to ensure that the minimum payment has been
made which is known by what was contracted and that contract is stored
in the datum of the oracle [see this link](https://github.com/input-output-hk/plutus-pioneer-program/blob/main/code/week06/src/Week06/Oracle/Swap.hs).

The oracle gets updated by the pab and then is referenced by the
validator. The pab must listen for requests, monitor the database to
see when that request was completed (a deposit of a specific ammount
into a special CD account that can only be deposited into; if account
does not have an instance associated with it, the money is bounced
back; if the ammount is incorrect, it is bounced back; if it is
correct and the pab approves it, the money is locked until someone
redeems a portion of it). There is another app that monitors the
blockchain and collects NCUA audits.

[Powerful
module](https://github.com/input-output-hk/plutus/blob/229eba89ba02f6e9f78f7cedb219eb3cd006fdf1/plutus-contract/src/Plutus/Contract/Request.hs)
that provides tools for waiting for a utxo to be spento r funds to be
present at a location or for a certain slot to be passed.

### Product

 1. Databasing
 2. Smart contract
 3. Plutus Application Backend
 4. Wallet Integration

### Links

 #. [postgres](https://www.youtube.com/watch?v=Cio3kOEdai0)
 #. [NCUA rules and regs](https://www.ncua.gov/regulation-supervision/rules-regulations)
 #. [Cybersecurity](https://www.ncua.gov/regulation-supervision/regulatory-compliance-resources/cybersecurity-resources)
 #. [IT Handbook](https://ithandbook.ffiec.gov/
 
 
[ECFR](https://www.ecfr.gov/cgi-bin/text-idx?SID=e021912bbc9ced245472812c0d0309ca&mc=true&tpl=/ecfrbrowse/Title12/12chapterVII.tpl)

The system may help the bank respond rappidly to nacent threats or
quickly implement [stress
testing](https://www.ncua.gov/regulation-supervision/regulatory-compliance-resources/capital-planning-stress-testing-resources)
as required by federal regultaion.


### Schedule

## Cost

## Progress

### Results

### Tasks

 - [ ] Haskell interface with DB2.

### Log

20210808134828NJ I am figuring out the databasing of the things.

20210808172721NJ I studied how to use PostgreSQL by referencing the postgresql-13-US.pdf file. I set up a scheme according to [this Quora answer](https://www.quora.com/Does-banks-store-money-in-SQL?share=1). 

20210808172921NJ I just found a post that recommends an IBM mainframe with the DB2 database system and cites that this is what most banks around the world use.

20210808175830NJ DB2 uses SQL language, so it should be fine. 

20210817023724NJ I took several notes nad studied the oracle/pab stuff. I have found a rules and regulations page on the NCUA website.
