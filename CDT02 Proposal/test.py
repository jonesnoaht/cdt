def solution(S, K):    
    if S == "Mon":
        d = 0
    if S == "Tue":
        d = 1
    if S == "Wed":
        d = 2
    if S == "Thu":
        d = 3
    if S == "Fri":
        d = 4
    if S == "Sat":
        d = 5
    if S == "Sun":
        d = 6
    a = (K + d) % 7;    
    if d == 0:
        return("Mon")
    if d == 1:
        return("Tue")
    if d == 2:
        return("Wed")
    if d == 3:
        return("Thu")
    if d == 4:
        return("Fri")
    if d == 5:
        return("Sat")
    if d == 6:
        return("Sun")

