~~~database
source: Book Library/Books
name: Table
view: table
show: author, status, pages
sort: pages desc
---
name: Total
view: number
filter: status = read
value: pages
agg: sum
---
name: By status
view: board
group: status
---
name: Reading
view: gallery
filter: status = reading
show: author, pages
---
name: Completed
view: gallery
filter: status = read
show: author, rating
---
name: TBR
view: gallery
filter: status = todo
show: author, pages
---
name: All books
view: table
show: author, status, pages
sort: pages desc
---
name: Total count
view: number
filter: status != read
value: pages
agg: sum
---
name: By status 2
view: donut
group: status
value: pages
agg: sum
~~~
