// you can write to stdout for debugging purposes, e.g.
// console.log('this is a debug message');

function solution(S, K) {
    
    if (S == "Mon") {let d = 0;};
    if (S == "Tue") {let d = 1;};
    if (S == "Wed") {let d = 2;};
    if (S == "Thu") {let d = 3;};
    if (S == "Fri") {let d = 4;};
    if (S == "Sat") {let d = 5;};
    if (S == "Sun") {let d = 6;};

    a = (K + d) % 7;
    
  if (a == "Mon") {let d = 0;};
    if (S == "Tue") {let d = 1;};
    if (S == "Wed") {let d = 2;};
    if (S == "Thu") {let d = 3;};
    if (S == "Fri") {let d = 4;};
    if (S == "Sat") {let d = 5;};
    if (S == "Sun") {let d = 6;};
};
    // write your code in JavaScript (Node.js 8.9.4)
};
