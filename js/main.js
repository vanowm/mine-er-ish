// jshint -W082
{
"use strict";

const EL = new Proxy({},{get(target, prop){return prop in target ? target[prop] : (target[prop] = document.getElementById(prop));}}),
      MINE = 9,
      OPEN = 16,
      SHOW = 32,
      FLAG = 64,
      TYPE = OPEN - 1,
      WIN = 1,
      LOOSE = 2,
      OFFSET = [-1,-1,0,-1,1,-1,1,0,1,1,0,1,-1,1,-1,0], //offset around current coordinate
      BORDERS = ["top", "right", "bottom", "left"],
      anim = {
        clock: [],
        shake: 0,
      },
      tableBox = EL.table.parentNode,
      settings = new Proxy(
      {
        width: {default: 10, value: 10, min: 2, max: 300},
        height: {default: 10, value: 10, min: 2, max: 300},
        mines: {default: 15, value: 15, min: 1, max: 9998},
        zoom: {default: 5, value: 5, min: 1, max: 30},
        click: {default: true, value: true},
        openFirst: {default: 18, value: 18},
        darkMode: {default: 0, value: 0, min: 0, max: 2},
        table: {default: [], value: []},
        stats: {
          start: 0,
          mines: 0,
          time: 0,
          timestamp: 0,
          open: 0,
          pauseTime: 0,
          pauseStart: 0,
          steps: [] //list of indexes, bit1 = flag
        }
      },
      {
        get(target, prop, proxy)
        {
          if (prop === "init")
            return () => this.init(target);

          if (prop == "save")
            return this.save(target);

          if (["min", "max", "default"].includes(prop))
            return Object.keys(target).reduce((obj, key) => 
            {
              if (key == "mines" && prop == "max")
              {
                target[key][prop] = target.width.value * target.height.value - 1;
              }
              obj[key] = target[key][prop];
              return obj;
            }, {});

          return target[prop] && (target[prop].value === undefined ? target[prop] : target[prop].value);
        },

        set(target, prop, value, proxy)
        {
          value = this.check(target, prop, value);

          if (value === undefined)
            return;

          target[prop].value = value;
          if (target[prop].onChange instanceof Function)
            target[prop].onChange(value);

          return this.save(target);
        },

        init(target, data)
        {
          if (data === undefined)
            data = JSON.parse(localStorage.getItem("mineSettings")) || {};

          for(let i in target)
          {
            if (i == "table" && data[i])
            {
              data[i] = decode(data[i]);
            }
            let value = this.check(target, i, data[i]),
                obj = false;
            if (value !== null && value instanceof Object && !(value instanceof Array))
            {
              value = this.init(value, value);
              obj = true;
            }

            if (value === undefined)
              continue;

            if (obj)
              target[i] = value;
            else
              target[i].value = value;
          }
          return target;
        },

        load(target)
        {

        },


        save(target)
        {
          return localStorage.setItem("mineSettings",  JSON.stringify(Object.keys(target).reduce((obj, key) =>
          {
            let val = target[key].value;
            if (key == "table")
            {
              val = encode(val);
            }
// for(let i = 0; i < 256; i++)
// {
//   console.log(i.toString(16), JSON.stringify(String.fromCharCode(i)))
// }
            if (val === undefined)
              val = target[key];

            obj[key] = val;
            return obj;
          }, {})));
        },

        check(target, prop, value)
        {
          let res = prop in target && target[prop] !== null && (typeof target[prop].value == typeof value || typeof target[prop] == typeof value);
          if (res && target[prop] instanceof Object && target[prop] !== null && "min" in target[prop] && value < target[prop].min)
            return target[prop].min;

          if (res && target[prop] instanceof Object && target[prop] !== null && "max" in target[prop] && value > target[prop].max)
            return target[prop].max;

          return res ? value : undefined;
        }
      });



let timerTimeout,
    dragScroll = false,
    gameStatus = 0;

settings.init();
setZoom();
setTheme();
[...document.querySelectorAll(".menu input, .menu select")].map(el =>
{
  if (el.type == "checkbox")
  {
    el.checked = settings[el.id];
  }
  else if (el.tagName == "SELECT")
  {
    let option = document.createElement("option");
    for(let i = settings.min[el.id],  def = settings.default[el.id]; i <= settings.max[el.id]; i++)
    {
      option = option.cloneNode(true);
      option.textContent = i;
      option.value = i;
      option.className = i == def ? "default" : "";
      el.appendChild(option);
    }
    el.value = settings[el.id];
  }
  else
  {
    el.value = settings[el.id];
    el.min = settings.min[el.id];
    el.max = el.id == "mines" ? settings.width * settings.height - 1 : settings.max[el.id];

  }
  let timerInput, timerFilter;
  el.addEventListener("input", e => 
  {
    const isCheckbox = el.type == "checkbox",
          isSelect = el.tagName  == "SELECT",
          value = isCheckbox ? el.checked : isSelect ? ~~el.value : Math.max(el.min, Math.min( ~~el.value, el.max));

    if (!isCheckbox && !isSelect)
    {
      clearTimeout(timerFilter);
      if (el.value != value)
      {
        timerFilter = setTimeout(() => (el.value = value, init(true)), 3000);
      }
    }
    settings[el.id] = value;
    if (isCheckbox)
      return;

    if (el.id != "mines")
    {
      const max = settings.width * settings.height - 1;
      EL.mines.max = max;
      if (~~EL.mines.value > max)
      {
        settings.mines = max;
        EL.mines.value = max;
      }
    }
    clearTimeout(timerInput);
    timerInput = setTimeout(() => init(true), isSelect ? 0 : 300);

  });
});

{
  let scaling = false,
      timerZoom,
      clientX = 0,
      clientY = 0,
      mouseDown = null;

  window.addEventListener("touchstart", e =>
  {

    if (e.touches.length === 2)
    {
      scaling = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
      last = scaling;
      e.preventDefault();
    }
  });
  window.addEventListener("touchmove", e =>
  {
    if (!scaling)
      return;
    
    e.preventDefault();
    const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
    let zoom = settings.zoom;
    // EL.difficulty.textContent = [settings.zoom, settings.min.zoom, settings.max.zoom];

    if (Math.abs(dist - scaling) > 10)
    {
      zoom += dist - scaling > 0 ? 1 : -1;
      if (zoom < settings.min.zoom)
        zoom = settings.min.zoom;

      if (zoom > settings.max.zoom)
        zoom = settings.max.zoom;

      scaling = dist;
      settings.zoom = zoom;
      timerZoom = setTimeout(setZoom, 10);
    }

  },{passive: false});
  window.addEventListener("touchend", e =>
  {
    if (!scaling)
      return;

    scaling = false;
  });

  window.addEventListener("wheel", e =>
  {
    
    if (e.ctrlKey)
    {
      if (!e.isTrusted)
        return;

      e.ctrlKey = false;
      return;
    }

    let zoom = settings.zoom;
    // EL.difficulty.textContent = [settings.zoom, settings.min.zoom, settings.max.zoom];

    zoom += e.deltaY < 0 ? 1 : -1;
    if (zoom < settings.min.zoom)
      zoom = settings.min.zoom;

    if (zoom > settings.max.zoom)
      zoom = settings.max.zoom;

    settings.zoom = zoom;
    timerZoom = setTimeout(setZoom, 10);

  },{passive: false});


  function onMouseMove (e)
  {
    if ((dragScroll && e.clientX == clientX && e.clientY == clientY)
          || (!dragScroll && Math.hypot(e.clientX - clientX, e.clientY - clientY) < 8)) //allow 6px movement
      return;

    clearTimeout(timerTimeout);
    document.body.classList.add("drag");
    if (!dragScroll)
    {
      // ({clientX, clientY} = e);
    }

    document.body.classList.add("dragging");
    tableBox.scrollBy(clientX - e.clientX, clientY - e.clientY);
    dragScroll = true;
    // mouseDown.preventDefault();
    // mouseDown.stopPropagation();
    ({clientX, clientY} = e);

  }
  function onMouseUp(e)
  {
    clearTimeout(timerTimeout);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("mousemove", onMouseMove);
    document.body.classList.remove("drag");
    document.body.classList.remove("dragging");
    // if (dragScroll)
    // {
    //   e.preventDefault();
    //   e.stopPropagation();
    //   console.log(e);
    // }

  }

  EL.table.addEventListener("mousedown", e =>
  {
    timerTimeout = setTimeout(() =>
    {
      document.body.classList.add("drag");
      dragScroll = true;
    }, 3000);
    mouseDown = e;
    dragScroll = false;
    ({clientX, clientY} = e);
    e.preventDefault();
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
  });
}
EL.reset.addEventListener("click", init);
EL.table.addEventListener("click", onClick);
EL.table.addEventListener("auxclick", onClick);
EL.table.addEventListener("contextmenu", onClick);
EL.pause.addEventListener("click", e =>
{
  pause();
});




init(!settings.table.length);

function pause(p)
{
  if (p === undefined)
  {
    p = !settings.stats.pauseTime;
    if (p && !settings.stats.start)
      return;
  }

  document.body.classList.toggle("pause", p ? true : false);
  if (p)
  {
    if (!settings.stats.start)
      return;

    settings.stats.pauseTime = new Date().getTime();
    settings.stats.pauseStart = settings.stats.start;
    settings.stats.start = 0;
  }
  else
  {
    if (settings.stats.pauseTime )
      settings.stats.start = new Date().getTime() - settings.stats.pauseTime  + settings.stats.pauseStart ;

    settings.stats.pauseTime  = 0;
  }
  settings.save;
}

function setZoom(z)
{
  if (z === undefined)
    z = settings.zoom;
  document.body.style.setProperty("--zoom", ((z/7*z/7) + 1) +"em");

}

function onClick(e)
{
  e.preventDefault();

  if (dragScroll || e.target === EL.table || (e.type == "auxclick" && e.button == 2) || (!settings.stats.start && settings.stats.time))
    return;

  const index = Array.from(EL.table.children).indexOf(e.target),
        leftClick = settings.click ? e.type == "click" : e.type != "click";

  let val = settings.table[index];
  if ((leftClick && (val & OPEN || val & FLAG || val & SHOW)) || (!leftClick && val & OPEN))
    return console.log("already clicked");

  settings.stats.steps[settings.stats.steps.length] = (index << 1) | !leftClick; //set bit1 = flag

  if (!settings.stats.start)
    timer();

  if (leftClick)
  {
    openCell(index);
    if ((val & TYPE) == MINE)
    {
      settings.stats.time = new Date().getTime() - settings.stats.start;
      return finished();
    }
  }
  else
  {
    settings.table[index] ^= FLAG;
    e.target.dataset.type = FLAG;
    settings.stats.mines += val & FLAG ? -1 : 1;
  }

  if (!(settings.table[index] & OPEN + FLAG))
    delete e.target.dataset.type;

  if (isWon())
  {
    settings.stats.time = new Date().getTime() - settings.stats.start;
    finished(true);
  }
  settings.save;
  //  e.target.textContent = val;
}

function finished(won)
{
  settings.stats.start = 0;
  document.body.classList.add("finished");
  if (won)
  {
    console.log("you win!");
    EL.table.classList.add("won");
    gameStatus = WIN;

  }
  else
  {
    console.log("game over");
    gameStatus = LOOSE
  }
  let steps = settings.stats.steps.map(a => a >> 1);
  for(let i = 0; i < settings.table.length; i++)
  {
    const elCell = EL.table.children[i];
    if (settings.table[i] & OPEN+FLAG)
    {
      elCell.classList.add("opened");
    }
    else
    {
      settings.table[i] |= SHOW;
      elCell.classList.add("shown");
    }
    const type = settings.table[i] & TYPE;
    elCell.dataset.type = type;
    if (settings.table[i] & FLAG)
      elCell.classList.add("flag");

    const pos = steps.reduce((a, v, n) =>
    {
      if (v == i)
        a[a.length] = n + 1;

        return a;
    }, []);
    if (pos.length)
    {
      elCell.dataset.step = pos;
    }
    const borders = getBorders(i);

    for(let b = 0; b < borders.length; b++)
      elCell.classList.toggle(BORDERS[b], Boolean(borders[b]));
  
  }
  EL.table.children[settings.stats.steps[settings.stats.steps.length - 1]>>1].classList.add("last");
  settings.save; //save settings
}

function isFinished()
{
  let good = 0,
      killed = 0;

  for(let i = 0; i < settings.table.length; i++)
  {
    const val = settings.table[i],
          type = val & TYPE,
          isFlag = val & FLAG,
          isOpen = val & OPEN,
          isShow = val & SHOW;

    if (type == MINE && isFlag || (type != MINE && !isFlag && isOpen))
      good++;

    if (isShow || (isOpen && type == MINE & !isFlag))
      killed = 2;
  }
  return good == settings.table.length ? 1 : killed;
}
function isWon()
{
  for(let i = 0; i < settings.table.length; i++)
  {
    const val = settings.table[i],
          type = val & TYPE;

    if (val & SHOW || (!(type != MINE && val & OPEN) && !(type == MINE && val & FLAG)))
      return false;
  }
  return true;
}

function timer(timestamp)
{
  if (timestamp === undefined)
  {
    settings.stats.start = new Date().getTime();
  }

  if (timestamp - settings.stats.timestamp > 15)
  {
    settings.stats.timestamp = timestamp;
    if (settings.stats.start)
      settings.stats.time = new Date().getTime() - settings.stats.start;

    let time = getTimeData(settings.stats.time).string;//.split(/[:.]/);
    for(let i = 0, val; i < EL.clock.children.length; i++)
    {
      val = time[EL.clock.children[i].dataset.time];
      if (anim.clock[i] != val)
      {
        anim.clock[i] = val;
        EL.clock.children[i].textContent = val;
      }
    }

    EL.minesFound.textContent = settings.stats.mines;
    EL.minesPercent.textContent = Math.round(settings.stats.mines * 100 / settings.mines); 
    EL.steps.textContent = settings.stats.steps.length;
    EL.clock.classList.toggle("blink", time.ms > 500);
  }
  if (gameStatus == 2 && (!anim.shake || timestamp - anim.shake > 1000))
  {
    anim.shake = timestamp;
    for(let i = 0; i < 11; i++)
    {
      document.body.style.setProperty("--shakeX" + i, ~~(Math.random() * 10 -5)/60 + "em");
      document.body.style.setProperty("--shakeY" + i, ~~(Math.random() * 10 -5)/60 + "em");
      document.body.style.setProperty("--shakeR" + i, ~~(Math.random() * 10 -5) + "deg");
    }
  }
  // if (timestamp - anim.timers.blink > 1000)
  // {
  //   anim.timers.blink = timestamp;
  //   anim.blink = settings.stats.start && !anim.blink;
  //   EL.clock.classList.toggle("blink", anim.blink);
  // }
  requestAnimationFrame(timer);
}

function getTime(time)
{
  const t = getTimeData(time);
  return (t.d ? t.d+"d":"") +
          (""+t.h).padStart(2,0) + ":" + 
          (""+t.m).padStart(2,0) + ":" + 
          (""+t.s).padStart(2,0) + "." + 
          (""+t.ms).padStart(3,0);
}

function getTimeData(time, string)
{
	let sec = ~~(time / 1000);
	const ms = time % 1000,
	      s = sec % 60,
        secm = (sec - s) / 60,
        m = secm % 60,
        h = ((secm - m) / 60) % 24,
        d = ~~(time / 86400000);
	return {d,h,m,s,ms, string:{
    d: d ? d + "d": "",
    h: (""+h).padStart(2,0),
    m: (""+m).padStart(2,0),
    s: (""+s).padStart(2,0),
    ms: (""+ms).padStart(3,0)
  }};
}

// function getTime(time)
// {
//   return time > 8553599999 ? "99:59:59.999" : new Date(time).toISOString().replace(/(\d+)T(\d+)/, (a,b,c) => (~~b-1? ("0"+Math.min(((~~b-1)*24+~~c), 99)).substr(-2) : c)).substring(8, 20);
// }

function getBorders(index) //set borders around same type of cells
{
  const item = settings.table[index],
        borders = [],
        isOpen = ~~Boolean(item & OPEN),
        isFlag = ~~Boolean(item & FLAG),
        isShow = ~~Boolean(item & SHOW),
        value = item & TYPE,
        neighbors = [
          getIndexOffset(index, 0, -1), /*top*/
          getIndexOffset(index, 1, 0), /*right*/
          getIndexOffset(index, 0, 1), /*bottom*/
          getIndexOffset(index, -1, 0) /*left*/
        ];
// const deb2 = {i:index, v:value};
// deb2["|" + (item < 0 ? "------" : (isFlag?"f":"-") + (isShow?"s":"-") + (isOpen?"o":"-") + value.toString(2).padStart(Math.log2(TYPE)+1,0))] = item < 0 ? -1 : item;
// console.log(deb2);
  for(let i = 0; i < neighbors.length; i++)
  {
    const nItem = settings.table[neighbors[i]] === undefined ? -(FLAG << 1) : settings.table[neighbors[i]],
          nOpen = ~~Boolean(nItem & OPEN),
          nFlag = ~~Boolean(nItem & FLAG),
          nShow = ~~Boolean(nItem & SHOW),
          nValue = nItem & TYPE;
// const deb = {};
// deb[["T","R","B","L"][i]] = nItem < 0 ? -1 : nValue;
// deb["|" + (nItem < 0 ? "------" : (nFlag?"f":"-") + (nShow?"s":"-") + (nOpen?"o":"-") + nValue.toString(2).padStart(Math.log2(TYPE)+1,0))] = nItem < 0 ? -1 : nItem;
// console.log(Object.assign(deb, {r:""+[
//         (nValue == MINE && value == MINE && (isOpen + isShow) && (nOpen + nShow)),
//         (value != MINE && nValue != MINE && (isOpen == nOpen || isShow == nShow)),
//         (isFlag && isFlag == nFlag),

//         nValue == MINE, value == MINE, (isOpen + isShow), (nOpen + nShow)
// ]}));
    borders[i] = !(nItem >= 0 && ((value == MINE && value == nValue && (isOpen + isShow) && (nOpen + nShow)) || (value != MINE && nValue != MINE && (isOpen == nOpen || isShow == nShow)) || (isFlag && isFlag == nFlag)));
  }
// console.log(borders)
  return borders;

}

function openCell(index, table)
{
  let array = [index],
      ret = {},
      show = false;

  if (!table)
  {
    show = true;
    table = Object.assign([], settings.table);
  }

  while(array.length)
  {
    index = array.pop();
    if (show)
    {
      const elCell = EL.table.children[index];
      elCell.dataset.type = table[index] & TYPE;
      elCell.classList.add("shown");
    // const borders = getBorders(index);
    // for(let b = 0; b < borders.length; b++)
    //   elCell.classList.toggle(BORDERS[b], Boolean(borders[b]));

      if (!(table[index] & OPEN))
        settings.stats.open++;

    }
    table[index] |= OPEN;
    ret[index] = table[index];
    if (table[index] != OPEN)
      continue;

    for(let o = 0; o < OFFSET.length; o+=2)
    {
      let i = getIndexOffset(index, OFFSET[o], OFFSET[o+1]),
          val = table[i]; //right

      if (val === undefined || val == MINE || val & FLAG)
        continue;

      if (val === 0)
      {
        array[array.length] = i;
        continue;
      }
      
      if (!(val & OPEN))
      {
        if (show)
        {
          if (val)
            EL.table.children[i].dataset.type = val;

          if (!(settings.table[i] & OPEN))
            settings.stats.open++;
            EL.table.children[i].classList.add("shown");
        }
        table[i] |= OPEN;
      }
      ret[i] = table[i];
    }
  }
  if (show)
    settings.table = table;

  return ret;

}

function rand(min, max)
{
  return Math.round(Math.random() * (max - min) + min);
}

function init(reset = false)
{
  gameStatus = 0;
  EL.table.className = "";
  document.body.classList.remove("finished");
  settings.stats.timestamp = 0;
  let opened = false;
  for(let i = 0, mask = OPEN + FLAG; i < settings.table.length; i++)
  {
    if (settings.table[i] & mask)
    {
      opened = true;
      break;
    }
  }
  if(!opened)
    reset = true;

  if (reset)
  {
    for(let i in settings.stats)
      settings.stats[i] = 0;

    settings.stats.steps = [];
    settings.table.length = 0; //reset
  }
  settings.table.length = settings.width * settings.height;
  if (reset)
  {
    const max = Math.min(settings.mines, settings.table.length - 1);
    let mines = 0;

    while(mines < max)
    {
      const mine = rand(0, settings.table.length-1);
      if (!settings.table[mine])
      {
        mines++;
        settings.table[mine] = MINE;
      }
    }
  }
  while(EL.table.children.length > settings.table.length)
    EL.table.removeChild(EL.table.lastChild);

  let started = false,
      flags = 0,
      mines = 0,
      perfect = 0,
      perfectSteps = [],
      perfectList = {},
      table = [];

  for(let i = 0, OPENED = OPEN + SHOW; i < settings.table.length; i++)
  {
    const elCell = EL.table.children[i] || document.createElement("span"),
          item = settings.table[i];

    let itemType = item & TYPE;

    if (!elCell.parentNode)
      EL.table.appendChild(elCell);

    elCell.className = "";
    for(let i in elCell.dataset)
      delete elCell.dataset[i];

    if (reset)
    {
      let minesNum = 0;
      if (item != MINE)
      {
        for(let o = 0; o < OFFSET.length; o+=2)
        {
          let index = getIndexOffset(i, OFFSET[o], OFFSET[o+1]); //right
  // console.log(i, index, mines);
          if (settings.table[index] == MINE)
            minesNum++;
        }
        settings.table[i] = itemType = minesNum;
      }
      // elCell.textContent = table[i];
      // for(let i in elCell.dataset)
      //   delete elCell.dataset[i];

//      elCell.className = "";
    }
    else
    {
      if (item & OPENED)
      {
        elCell.classList.add("shown");
        elCell.dataset.type = item & TYPE;
        started = true;
      }
      if(item & FLAG)
      {
        elCell.dataset.type = FLAG;
        flags++;
        started = true;
      }
    }
    if ((settings.table[i] & TYPE) == MINE)
      mines++;

    table[table.length] = itemType;
  }//for settings.table
  const _table = Object.assign([], table);
  for(let i = 0; i < settings.table.length; i++)
  {
    if (perfectList[i] !== undefined || (settings.table[i] & TYPE) != 0)
      continue;

    Object.assign(perfectList, openCell(i, _table));
    perfect++;
    perfectSteps[perfectSteps.length] = i;
  }
// console.log(table);

// console.log(settings.table);
// console.log(perfectSteps);
// console.log(perfectList);
  for(let i = 0; i < settings.table.length; i++)
  {
    if (perfectList[i] === undefined && (settings.table[i] & TYPE) != MINE)
    {
      perfect++;
      perfectList[i] = settings.table[i];
      perfectSteps[perfectSteps.length] = i;
    }
  }
  // console.log(perfectList);

  if (started && difficulty() > settings.openFirst)
  {
    perfect--;
  }
// console.log(perfect, mines, perfectSteps);
  // if (flags !== settings.stats.mines)
  // {
  //   settings.stats.mines = flags;
  // }
  document.body.style.setProperty("--cols", settings.width);
  document.body.style.setProperty("--rows", settings.height);
  // for(let i = 0; i < settings.height; i++)
  //   console.log(settings.table.slice(i * settings.width, i * settings.width + settings.width));
  
  EL.minesTotal.textContent = settings.mines;
  settings.save; //save settings
  timer(0);
  const finish = isFinished();
  if (finish)
    finished(finish == 1);

  EL.difficulty.textContent = ["Can't loose", "Don't wanna think", "Super easy", "Easy", "Normal", "Medium", "Hard", "Very hard", "I can do this!", "I'll try it anyway", "Impossible", "Gotta buy a lottery"][Math.min(~~(difficulty() * 3 / 11), 11)];// + " [" + ~~(difficulty()) + "%]";
  EL.difficulty.dataset.value = ~~(difficulty() + 1);

  if (!started && difficulty() > settings.openFirst)
  {
    let empty = [];
    for(let i = 0; i < settings.table.length; i++)
    {
      if (!settings.table[i])
        empty[empty.length] = i;
    }
    empty = empty[~~(rand(0, empty.length-1))];
    if (empty !== undefined)
    {
      perfect--;
      openCell(empty);
    }

  }
  EL.perfect.textContent = perfect + mines;
  pause(settings.stats.pauseTime);
}// init();

function difficulty()
{
  return settings.mines * 100 / (settings.width * settings.height);
}

function indexToXY(index, width = settings.width, height = settings.height)
{
  return {x: index % width, y: ~~(index / width)};
}

function getIndexOffset(index, offsetX, offsetY, width = settings.width, height = settings.height)
{
  let {x, y} = indexToXY(index, width, height);
  x += offsetX;
  y += offsetY;
  if (x < 0 || x > width-1 || y < 0 || y > height-1)
    return -1;

  return y * width + x;
}



function setTheme(theme)
{
  if (theme === undefined)
    theme = settings.darkMode;

  if (theme == 2)
    document.documentElement.removeAttribute("theme");
  else
    document.documentElement.setAttribute("theme", settings.darkMode ? "dark" : "light");

  settings.darkMode = theme;
  const style = document.getElementById("dropdownstyle") || document.createElement("style"),
        s = getComputedStyle(document.querySelector("select")),
        css = `label.dropdown{${Array.from(s).map(k =>`${k}:${s[k]}`).join(";")}}`;

  style.innerHTML = css;
  style.id = "dropdownstyle";
  document.head.insertBefore(style, document.head.querySelector("[rel='stylesheet']"));
  document.documentElement.style.setProperty("--textColor", getComputedStyle(document.documentElement).color);
}



function encode(val)
{
  const r = [],
        bits = Math.log2(FLAG) + 1,
        max = ~~(32 / bits);

  for(let i = 0; i < val.length; i+=max)
  {
    let v = 0;
    for(let n = 0; n < max; n++) //combine 4 6-bit numbers into 1 32-bit
    {
      v |= ~~val[i + n] << ((max-1-n)*bits);
    }

    r[r.length] = v.toString(36);
  }
  return r.join("\xad");//separate text with "invisible" character
}

function decode(val)
{
  val = val.split("\xad");
  let r = [],
      bits = Math.log2(FLAG) + 1,
      max = ~~(32 / bits),
      mask = (FLAG << 1) - 1;

  for(let i = 0; i < val.length; i++)
  {
    let id = (i+1) * max;
    for(let n = 0; n < max; n++)
      r[id-n-1] = parseInt(val[i], 36) >> n*bits & mask;
  }
  return r;
}



(() =>
{
  if (!EL.tableCanvas)
    return;

const canvas = EL.tableCanvas,
      ctx = canvas.getContext("2d"),
      mouse = {
        wx: 0, //world position
        wy: 0,
        sx: 0, //screen position
        sy: 0,
        button: 0
      },
      pos = {
        wx: 0, //world position
        wy: 0,
        sx: 0, //screen position
        sy: 0,
        scale: 0
      },
      zoomed = n => ~~(n * pos.scale),
      zoomedX = n => ~~((n - pos.wx) * pos.scale + pos.sx),
      zoomedY = n => ~~((n - pos.wy) * pos.scale + pos.sy),
      zoomedX_inv = n => ~~((n - pos.sx) * (1 / pos.scale) + pos.wx),
      zoomedY_inv = n => ~~((n - pos.sy) * (1 / pos.scale) + pos.wy);
        // or return Math.floor((number - sy) / scale + wy);

ctx.width = 16384;
ctx.height =16384;
})();
}