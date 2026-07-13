--- 

author: Noah Jones
title: 20210809NJ-Database Setup
date: 2021-08-09

---

# 20210809NJ-Database Setup

## Background

> {- | Connect to a PostgreSQL server.
> 
> See <http://www.postgresql.org/docs/8.1/static/libpq.html#LIBPQ-CONNECT> for the meaning
> of the connection string. -}
> connectPostgreSQL :: String -> IO Connection
> 
> An example would be:
> dbh <- connectPostgreSQL "host=localhost dbname=testdb user=foo"

```{haskell}
conn <- connectPostgreSQL "host=Noah-MBP.local dbname=bank_accounts user=noahjones"
run conn "INSERT INTO bank (bank_id, bank_details) VALUES ('CampusUSA', 'Campus USA Credit Union');" []
commit conn
quickQuery conn "SELECT * FROM bank;" []
let q = "SELECT * FROM transactions;" :: String
quickQuery conn q []
```

## Compliance Considerations

## Plan

### Materials

| Name | Cat # | Lot | Size | Quantity |
|:-----|:------|:----|:-----|:---------|
|      |       |     |      |          |

[cabal](https://downloads.haskell.org/~cabal/Cabal-1.24.1.0/doc/users-guide/developing-packages.html)

### Schedule

## Cost

## Progress

### Results

### Tasks

### Log

20210809101438NJ Using [this](https://www.youtube.com/watch?v=Cio3kOEdai0) resource. `postgres -D /usr/local/var/postgres`

20210809102148NJ See code below

```{bash}
openssl req -new -x509 -days 365 -nodes -text -out server.crt \
	-keyout server.key -subj "/CN=Noah-MBP.local"
	
chmod og-rwx server.key
```

Port 5432

20210809105112NJ Figuring out the code. I think [this](https://github.com/input-output-hk/cardano-db-sync/blob/master/cardano-db-tool/src/Cardano/Db/Tool/Report/Balance.hs) and [this](https://github.com/input-output-hk/cardano-db-sync/blob/master/doc/interesting-queries.md) are what I have been looking for.

20210809105513NJ [Here](https://github.com/input-output-hk/plutus/blob/master/plutus-pab-client/pab-demo-scripts.nix) is an example that uses sqlite3.

20210809110709NJ The client is also the frontend tool. Instructions for getting started are [here](https://github.com/input-output-hk/plutus/tree/master/plutus-pab). 

20210809191323NJ It turns out that the trick is [HDBC](http://book.realworldhaskell.org/read/using-databases.html). The [wiki](https://github.com/hdbc/hdbc/wiki) is available and a good resource for learning.

20210809192559NJ [This one](https://livebook.manning.com/book/get-programming-with-haskell/chapter-41/) seems like a great resource.

20210809192853NJ We are in fact case sensitive when it comes to adding modules in cabal. We have to use the `:module` syntax as well when loading, and for some reason, `Database.HDBC` is the way that it has to be written. I have no idea where the `Database` part comes from (aside from the obvious). 

20210809195331NJ You must `commit conn` between transactions.
